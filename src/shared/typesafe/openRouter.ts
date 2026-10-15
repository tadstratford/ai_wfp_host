// Classifier (Jev) transport via OpenRouter's decisions endpoint.
//
// POST https://openrouter.ai/api/alpha/decisions with the native
// `{ model, state, questions }` body — no chat-completions mapping. The answer
// shapes are identical to the direct TypeSafe endpoint, so `types.ts` is shared.

import type { Question, ClassifierResponse } from "./types";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "~typesafe/jev-latest";

export class JevError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface JevResult {
  response: ClassifierResponse;
  ms: number;
  attempts: number;
}

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request = one `state` + many `questions` (fan-out). Retries 429/529/5xx
 * with exponential backoff + jitter. `ms` is wall time including retries.
 */
export async function askClassifier(
  state: unknown,
  questions: Record<string, Question>,
  opts: OpenRouterOptions,
): Promise<JevResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const maxAttempts = opts.maxAttempts ?? 5;
  const f = opts.fetchImpl ?? fetch;

  const siteUrl = process.env.OPENROUTER_SITE_URL || "";
  const appTitle = process.env.OPENROUTER_APP_TITLE || process.env.SERVER || "Workflow People";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": appTitle,
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  const body = JSON.stringify({ model, state, questions });

  const t0 = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await f(ENDPOINT, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt >= maxAttempts) throw new JevError(0, (e as Error).message);
      await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
      continue;
    }
    if (res.ok) {
      const response = (await res.json()) as ClassifierResponse;
      return { response, ms: Date.now() - t0, attempts: attempt };
    }
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt >= maxAttempts) {
      throw new JevError(res.status, text || res.statusText);
    }
    await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
  }
}
