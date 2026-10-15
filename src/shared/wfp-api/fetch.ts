// api.fetch — HTTP request from custom tool code.
//
// Security envelope (enforced regardless of caller intent):
//   - Refuses requests to private / loopback / link-local hosts.
//   - Caps the timeout at 60 seconds.
//   - Caps the response body at 5 MB.
//
// The fetch transport itself is the platform global `fetch` (browser or
// modern Node). wfp-api does not pull in a polyfill.

import type { FetchOptions, FetchResult } from "./types";

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Hosts/CIDRs that must not be reachable from tool code. */
const BLOCKED_HOSTS_LITERAL = new Set([
  "localhost",
  "0.0.0.0",
  "::",
  "::1",
]);

const PRIVATE_V4_PATTERNS: RegExp[] = [
  /^10\./,                                  // 10.0.0.0/8
  /^127\./,                                 // 127.0.0.0/8 (loopback)
  /^169\.254\./,                            // 169.254.0.0/16 (link-local)
  /^192\.168\./,                            // 192.168.0.0/16
  /^172\.(1[6-9]|2\d|3[01])\./,            // 172.16.0.0/12
];

const PRIVATE_V6_PATTERNS: RegExp[] = [
  /^fe80:/i,  // link-local
  /^fc/i,     // unique-local fc00::/7
  /^fd/i,     // unique-local fd00::/8 (subset of fc00::/7)
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS_LITERAL.has(host)) return true;
  if (PRIVATE_V4_PATTERNS.some((re) => re.test(host))) return true;
  if (PRIVATE_V6_PATTERNS.some((re) => re.test(host))) return true;
  return false;
}

export async function wfpFetch(
  url: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`api.fetch: invalid URL "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`api.fetch: only http/https are allowed (got "${parsed.protocol}")`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(
      `api.fetch: refusing to call a private/loopback host (${parsed.hostname}). External hosts only.`,
    );
  }

  const method = (options?.method || "GET").toUpperCase();
  const headers: Record<string, string> = { ...(options?.headers || {}) };

  let body: string | undefined;
  if (options?.body !== undefined) {
    if (typeof options.body === "string") {
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  const timeoutMs = Math.min(
    Math.max(0, options?.timeout ?? DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(parsed.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    const text = await readBodyCapped(resp);
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json — leave data === text */
    }
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });
    return { status: resp.status, headers: respHeaders, data, text };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBodyCapped(resp: Response): Promise<string> {
  if (!resp.body) {
    return resp.text();
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(
        `api.fetch: response exceeded ${MAX_RESPONSE_BYTES} bytes`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}
