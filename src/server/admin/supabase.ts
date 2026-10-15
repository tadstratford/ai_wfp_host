/**
 * Supabase REST Adapter — Zero Dependencies
 *
 * Thin fetch wrapper for Supabase PostgREST API.
 * Uses SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.
 */

import { EDITION } from "@shared/edition";

/** In EDITION=local there is no Supabase — every operation short-circuits with
 *  an error, which callers already degrade on (empty lists, defaults, no-ops). */
function isOffline(): boolean {
  return EDITION === "local";
}

const OFFLINE_ERROR = "local mode (no Supabase)";

const getConfig = () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
    }
    return { url: url.replace(/\/$/, ""), key };
};

function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const SUPABASE_TIMEOUT_MS = envInt("SUPABASE_TIMEOUT_MS", 15_000);
const SUPABASE_MAX_RETRIES = envInt("SUPABASE_MAX_RETRIES", 3);

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function backoffDelay(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 10_000);
}

/**
 * fetch with a per-attempt timeout and bounded retries for transient
 * failures (network errors and retryable HTTP statuses). Without this, a
 * hung or blipped PostgREST request fails the first time and is never
 * retried — the source of frequent silent data loss.
 */
async function fetchWithRetry(
    url: string,
    init: RequestInit,
): Promise<Response> {
    let lastError: string = "unknown error";
    for (let attempt = 0; attempt <= SUPABASE_MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            clearTimeout(timer);
            if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
                return res;
            }
            lastError = `HTTP ${res.status}`;
        } catch (err: any) {
            clearTimeout(timer);
            if (err?.name === "AbortError") {
                lastError = "timeout";
            } else {
                lastError = err?.message ?? "network error";
            }
        }
        if (attempt < SUPABASE_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
        }
    }
    throw new Error(`Supabase request failed after ${SUPABASE_MAX_RETRIES + 1} attempts: ${lastError}`);
}

type Filter = Record<string, string | number | boolean | null>;

function buildQueryParams(filters: Filter, columns?: string): string {
    const params = new URLSearchParams();
    if (columns) params.set("select", columns);
    for (const [key, value] of Object.entries(filters)) {
        if (value === null) {
            params.set(key, "is.null");
        } else {
            params.set(key, `eq.${value}`);
        }
    }
    return params.toString();
}

function headers(extra?: Record<string, string>): Record<string, string> {
    const { key } = getConfig();
    return {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
        ...extra,
    };
}

function restUrl(table: string, query?: string): string {
    const { url } = getConfig();
    const base = `${url}/rest/v1/${table}`;
    return query ? `${base}?${query}` : base;
}

export interface SupabaseResult<T = any> {
    data: T | null;
    error: string | null;
}

/**
 * SELECT rows from a table.
 * @param table - Table name
 * @param filters - Column eq filters (e.g., { user_id: "abc" })
 * @param columns - Comma-separated columns (default: "*")
 * @returns Array of matching rows
 */
export async function select<T = any>(
    table: string,
    filters: Filter = {},
    columns?: string
): Promise<SupabaseResult<T[]>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const query = buildQueryParams(filters, columns || "*");
        const res = await fetchWithRetry(restUrl(table, query), {
            method: "GET",
            headers: headers(),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `SELECT ${table}: ${res.status} ${body}` };
        }
        const data = await res.json() as T[];
        return { data, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * SELECT a single row. Returns first match or null.
 */
export async function selectOne<T = any>(
    table: string,
    filters: Filter,
    columns?: string
): Promise<SupabaseResult<T>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const query = buildQueryParams(filters, columns || "*");
        const res = await fetchWithRetry(restUrl(table, query), {
            method: "GET",
            headers: headers({ "Accept": "application/vnd.pgrst.object+json" }),
        });
        if (res.status === 406) {
            // No rows matched
            return { data: null, error: null };
        }
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `SELECT ONE ${table}: ${res.status} ${body}` };
        }
        const data = await res.json() as T;
        return { data, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * INSERT one or more rows.
 */
export async function insert<T = any>(
    table: string,
    data: Record<string, any> | Record<string, any>[]
): Promise<SupabaseResult<T[]>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const res = await fetchWithRetry(restUrl(table), {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `INSERT ${table}: ${res.status} ${body}` };
        }
        const result = await res.json() as T[];
        return { data: result, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * UPSERT one or more rows by primary key. Requires each payload object to
 * include the table's primary key so PostgREST can merge duplicates.
 */
export async function upsert<T = any>(
    table: string,
    data: Record<string, any> | Record<string, any>[]
): Promise<SupabaseResult<T[]>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const res = await fetchWithRetry(restUrl(table), {
            method: "POST",
            headers: headers({ "Prefer": "resolution=merge-duplicates,return=representation" }),
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `UPSERT ${table}: ${res.status} ${body}` };
        }
        const result = await res.json() as T[];
        return { data: result, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * UPDATE rows matching filters.
 */
export async function update(
    table: string,
    filters: Filter,
    data: Record<string, any>
): Promise<SupabaseResult<any[]>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const query = buildQueryParams(filters);
        const res = await fetchWithRetry(restUrl(table, query), {
            method: "PATCH",
            headers: headers(),
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `UPDATE ${table}: ${res.status} ${body}` };
        }
        const result = await res.json();
        return { data: result, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * DELETE rows matching filters.
 */
export async function del(
    table: string,
    filters: Filter
): Promise<SupabaseResult<any[]>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const query = buildQueryParams(filters);
        const res = await fetchWithRetry(restUrl(table, query), {
            method: "DELETE",
            headers: headers(),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `DELETE ${table}: ${res.status} ${body}` };
        }
        const result = await res.json();
        return { data: result, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}

/**
 * Call a Supabase RPC (stored function).
 */
export async function rpc<T = any>(
    functionName: string,
    params: Record<string, any> = {}
): Promise<SupabaseResult<T>> {
    if (isOffline()) return { data: null, error: OFFLINE_ERROR };
    try {
        const { url } = getConfig();
        const res = await fetchWithRetry(`${url}/rest/v1/rpc/${functionName}`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            const body = await res.text();
            return { data: null, error: `RPC ${functionName}: ${res.status} ${body}` };
        }
        const data = await res.json() as T;
        return { data, error: null };
    } catch (err: any) {
        return { data: null, error: err.message };
    }
}
