import { SessionParameter } from "@backend/types";
import type { MetaData } from "@backend/core/wfp/types";

/**
 * Parameter Helper Utilities
 *
 * All parameter values are stored as typed envelopes: { _meta: MetaData, data: any }
 * - getParameterValue() returns the unwrapped .data portion
 * - getParameterMetaValue() returns the _meta object
 * - setParameterValue() stores the full envelope as-is
 *
 * When databaseId is provided, getParameterValue/getParameterMetaValue
 * fall back to the workspace's `data` map if the name isn't found in session params.
 */

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

/** Check if a value is a TypedEnvelope */
function isEnvelope(value: any): boolean {
    return value && typeof value === 'object' && value._meta && typeof value._meta === 'object' && 'data' in value;
}

/** Unwrap .data from an envelope, or return value as-is if not an envelope */
function unwrapData(value: any): any {
    if (isEnvelope(value)) return value.data;
    return value;
}

/** Extract _meta from an envelope, or undefined if not an envelope */
function unwrapMeta(value: any): MetaData | undefined {
    if (isEnvelope(value)) return value._meta;
    return undefined;
}

// ---------------------------------------------------------------------------
// User data fallback (synchronous — Bun SQLite is sync)
// ---------------------------------------------------------------------------

/**
 * Look up a name in the active WorkspaceSession's `data` map and return as a
 * TypedEnvelope. Returns undefined if not found or no session is open.
 */
function lookupUserData(name: string, databaseId?: string): any | undefined {
    if (!databaseId) return undefined;
    try {
        const { getSessionByDatabaseId } = require('@backend/core/workspace/workspaceSessionStore');
        const session = getSessionByDatabaseId(databaseId);
        if (!session) return undefined;
        const entry = session.getDataEntry(name);
        if (!entry) return undefined;

        // Build envelope from stored metadata if available
        if (entry.content_type && entry.content_type !== 'text' && entry.content_json !== undefined) {
            return {
                _meta: {
                    type: entry.content_type,
                    source: `user_data:${name}`,
                    rowCount: entry.row_count ?? undefined,
                    columns: entry.columns,
                },
                data: entry.content_json,
            };
        }

        // Fall back to parsing content
        const content = typeof entry.content === 'string' ? entry.content : '';
        return parseRawUserData(content, name);
    } catch {
        return undefined;
    }
}

/**
 * Parse raw user data content into a TypedEnvelope (legacy fallback).
 * Auto-detects CSV, JSON, or plain text.
 */
function parseRawUserData(rawContent: string, sourceName: string): any {
    if (!rawContent || typeof rawContent !== 'string') {
        return { _meta: { type: 'text', source: `user_data:${sourceName}`, length: 0 }, data: '' };
    }

    const trimmed = rawContent.trim();

    // Try JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                const columns = parsed.length > 0 && typeof parsed[0] === 'object' ? Object.keys(parsed[0]) : undefined;
                return {
                    _meta: { type: 'json_array', source: `user_data:${sourceName}`, rowCount: parsed.length, columns },
                    data: parsed
                };
            }
            return {
                _meta: { type: 'json_object', source: `user_data:${sourceName}` },
                data: parsed
            };
        } catch { /* not valid JSON */ }
    }

    // Try CSV
    const lines = trimmed.split('\n');
    if (lines.length >= 2 && lines[0].includes(',')) {
        const rows = parseCsv(trimmed);
        if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            return {
                _meta: { type: 'csv', source: `user_data:${sourceName}`, rowCount: rows.length, columns },
                data: rows
            };
        }
    }

    // Plain text
    return {
        _meta: { type: 'text', source: `user_data:${sourceName}`, length: rawContent.length },
        data: rawContent
    };
}

/** Simple CSV parser */
function parseCsv(text: string): Record<string, string>[] {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
        rows.push(row);
    }
    return rows;
}

// ---------------------------------------------------------------------------
// Core parameter access
// ---------------------------------------------------------------------------

/**
 * Get the raw data value of a parameter (unwrapped from envelope).
 * Resolves {{variable_name}} template references.
 * Falls back to the workspace's `data` map when databaseId is provided.
 */
export function getParameterValue(
    params: SessionParameter[] | undefined,
    name: string,
    databaseId?: string,
    visited: Set<string> = new Set()
): any {
    if (!params) {
        // Try user_data fallback
        const ud = lookupUserData(name, databaseId);
        return ud ? unwrapData(ud) : undefined;
    }

    const rawValue = params.find(p => p.name === name)?.value;

    // Not found in session params — try user_data fallback
    if (rawValue === undefined) {
        const ud = lookupUserData(name, databaseId);
        return ud ? unwrapData(ud) : undefined;
    }

    // If it's an envelope, unwrap and return .data
    if (isEnvelope(rawValue)) {
        return rawValue.data;
    }

    // String values may contain {{template}} references
    if (typeof rawValue === 'string') {
        if (visited.has(name)) {
            console.warn(`[getParameterValue] Circular reference detected for variable: ${name}`);
            return rawValue;
        }

        const newVisited = new Set(visited);
        newVisited.add(name);

        // Exact match: {{variable_name}} → return the resolved value (unwrapped)
        const exactMatch = rawValue.match(/^\{\{\s*([^}]+)\s*\}\}$/);
        if (exactMatch) {
            const key = exactMatch[1].trim();
            const paramValue = getParameterValue(params, key, databaseId, newVisited);
            if (paramValue !== undefined) {
                return paramValue;
            }
            return rawValue;
        }

        // Partial match: "Hello {{name}}" → string interpolation
        if (rawValue.includes('{{') && rawValue.includes('}}')) {
            return rawValue.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, path) => {
                const key = path.trim();
                const paramValue = getParameterValue(params, key, databaseId, newVisited);
                if (paramValue !== undefined) {
                    return typeof paramValue === 'object' ? JSON.stringify(paramValue) : String(paramValue);
                }
                return match;
            });
        }
    }

    return rawValue;
}

/**
 * Get the _meta object for a parameter.
 * Falls back to the workspace's `data` map when databaseId is provided.
 */
export function getParameterMetaValue(
    params: SessionParameter[] | undefined,
    name: string,
    databaseId?: string
): MetaData | undefined {
    const rawValue = params?.find(p => p.name === name)?.value;

    if (rawValue !== undefined) {
        return unwrapMeta(rawValue);
    }

    // Try user_data fallback
    const ud = lookupUserData(name, databaseId);
    return ud ? unwrapMeta(ud) : undefined;
}

/**
 * Resolve `{{name}}` references inside a value, recursively through
 * objects/arrays. This is the single template resolver shared by the chat build
 * loop and the workflow executor: both resolve against the same
 * `session.parameters` store via `getParameterValue` (which unwraps envelopes,
 * interpolates nested references, and falls back to the workspace data map when
 * a databaseId is provided). Object/array values are JSON-stringified so they
 * survive a string-typed argument (e.g. the run_MCP bridge's `args`).
 */
export function resolveTemplates(
    value: unknown,
    params: SessionParameter[] | undefined,
    databaseId?: string
): unknown {
    if (typeof value === "string") {
        const exact = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
        if (exact) {
            const key = exact[1].trim();
            const resolved = getParameterValue(params, key, databaseId);
            if (resolved !== undefined) {
                return typeof resolved === "object" ? JSON.stringify(resolved) : resolved;
            }
            return value;
        }
        if (value.includes("{{") && value.includes("}}")) {
            return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, path: string) => {
                const key = path.trim();
                const resolved = getParameterValue(params, key, databaseId);
                if (resolved !== undefined) {
                    return typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
                }
                return _m;
            });
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => resolveTemplates(v, params, databaseId));
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = resolveTemplates(v, params, databaseId);
        }
        return out;
    }
    return value;
}

/**
 * Set parameter value by name (creates if doesn't exist).
 * Stores the value as-is (should be a TypedEnvelope from the API layer).
 */
export function setParameterValue(
    params: SessionParameter[] | undefined,
    name: string,
    value: any,
    type?: SessionParameter['type']
): SessionParameter[] {
    const parameters = params || [];
    const existingIndex = parameters.findIndex(p => p.name === name);

    if (existingIndex >= 0) {
        parameters[existingIndex].value = value;
        if (type) parameters[existingIndex].type = type;
    } else {
        parameters.push({
            name,
            type: type || 'object', // envelopes are always objects at the storage level
            value
        });
    }

    return parameters;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Merge parameters (new params override existing)
 */
export function mergeParameters(
    sessionParams: SessionParameter[] | undefined,
    newParams: SessionParameter[]
): SessionParameter[] {
    const merged = [...(sessionParams || [])];

    for (const newParam of newParams) {
        const existingIndex = merged.findIndex(p => p.name === newParam.name);
        if (existingIndex >= 0) {
            merged[existingIndex] = { ...merged[existingIndex], ...newParam };
        } else {
            merged.push(newParam);
        }
    }

    return merged;
}

/**
 * Get all parameter names (useful for showing "available variables")
 */
export function getParameterNames(params: SessionParameter[] | undefined): string[] {
    if (!params) return [];
    return params.map(p => p.name);
}

/**
 * Convert Record to SessionParameter[] for node configs.
 * Values are NOT wrapped in envelopes — the executor handles wrapping during prepareNodeParams.
 */
export function recordToParameters(
    record: Record<string, any> | undefined
): SessionParameter[] {
    if (!record) return [];

    return Object.entries(record).map(([name, value]) => ({
        name,
        type: inferType(value),
        value
    }));
}

/**
 * Convert old session.parameters Record to new array format
 */
export function migrateSessionParameters(
    oldParams: Record<string, any>
): SessionParameter[] {
    return Object.entries(oldParams).map(([name, value]) => ({
        name,
        type: inferType(value),
        value
    }));
}

/**
 * Convert session.parameters array to Record for backward compat
 */
export function parametersToRecord(
    params: SessionParameter[] | undefined
): Record<string, any> {
    if (!params) return {};
    const record: Record<string, any> = {};
    for (const param of params) {
        record[param.name] = param.value;
    }
    return record;
}

/**
 * Infer SessionParameter type from value
 */
function inferType(value: any): SessionParameter['type'] {
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value !== null) return 'object';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
}
