import { select, selectOne, insert, update, del, rpc } from "./supabase";
import { encrypt, decrypt } from "@backend/core/crypto";
import type { User } from "@backend/types";
import { normalizeGroupKeys } from "@shared/skillGroups";
import { normalizeNavKeys } from "@shared/navItems";
import {
  parseSecretsBlob,
  encryptSecretsBlob,
  readSecretsBlob,
  writeSecretsBlob,
} from "./keystore";

/** One usage bucket (day/month) × model aggregation row. */
export interface UsageBucket {
    bucket: string;
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
}

/** Decrypt and parse the encrypted_secrets column. Normalizes legacy plain-string values. */
// (parseSecretsBlob / encryptSecretsBlob now live in ./keystore — the seam
//  that also backs single-user file storage.)

/** Full column list for admin_users SELECT */
const USER_COLUMNS = [
    "user_id", "auth_user_id", "user_name", "user_email", "user_admin_flag",
    "database_id", "workspace_name", "dark_mode", "encrypted_llm_api_key", "encrypted_secrets",
    "llm_provider", "llm_model", "current_session_id", "current_workflow_id", "current_chat_mode", "chat_verbose",
    "persona_markdown", "last_login", "created_at", "credit_balance_usd",
    "skills_enabled", "nav_enabled"
].join(",");

/**
 * User Management Operations — Solo Edition (Supabase)
 * Canonical internal API for all admin_users mutations.
 */
export const userManager = {
    // List all users
    listUsers: async (): Promise<User[]> => {
        const { data, error } = await select("admin_users", {}, USER_COLUMNS);
        if (error) { console.error("[userManager] listUsers:", error); return []; }
        return (data || []).map(mapDbUserToDomain);
    },

    // Get user by ID
    getUser: async (userId: string): Promise<User | null> => {
        const { data, error } = await selectOne("admin_users", { user_id: userId }, USER_COLUMNS);
        if (error) { console.error("[userManager] getUser:", error); return null; }
        return data ? mapDbUserToDomain(data) : null;
    },

    // Get user by email
    getUserByEmail: async (email: string): Promise<User | null> => {
        const { data, error } = await selectOne("admin_users", { user_email: email }, USER_COLUMNS);
        if (error) { console.error("[userManager] getUserByEmail:", error); return null; }
        return data ? mapDbUserToDomain(data) : null;
    },

    // Get user by auth_user_id
    getUserByAuthId: async (authUserId: string): Promise<User | null> => {
        const { data, error } = await selectOne("admin_users", { auth_user_id: authUserId }, USER_COLUMNS);
        if (error) { console.error("[userManager] getUserByAuthId:", error); return null; }
        return data ? mapDbUserToDomain(data) : null;
    },

    // Is this email allowed to create an account? Read from the signup_allowlist
    // table (maintained via scripts/manage-allowlist.ts). Only 'allowed' rows count.
    isEmailAllowed: async (email: string): Promise<boolean> => {
        const normalized = (email || "").trim().toLowerCase();
        if (!normalized) return false;
        const { data, error } = await selectOne("signup_allowlist", { email: normalized, status: "allowed" }, "email");
        if (error) { console.error("[userManager] isEmailAllowed:", error); return false; }
        return !!data;
    },

    // ── Password auth (AUTH=password) ─────────────────────────────────────
    // The hash is a bcrypt string (Bun.password) and is never loaded into the
    // User context or the broad USER_COLUMNS mapping — only these targeted
    // accessors touch it.

    getPasswordHash: async (userId: string): Promise<string | null> => {
        const { data, error } = await selectOne("admin_users", { user_id: userId }, "password_hash");
        if (error) { console.error("[userManager] getPasswordHash:", error); return null; }
        return data?.password_hash ?? null;
    },

    getPasswordHashByEmail: async (email: string): Promise<string | null> => {
        const { data, error } = await selectOne("admin_users", { user_email: email }, "password_hash");
        if (error) { console.error("[userManager] getPasswordHashByEmail:", error); return null; }
        return data?.password_hash ?? null;
    },

    setPasswordHash: async (userId: string, hash: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, { password_hash: hash });
        if (error) console.error("[userManager] setPasswordHash:", error);
    },

    // Create user — always admin in solo
    createUser: async (params: {
        userName: string;
        userEmail: string;
        authUserId?: string;
        isAdmin?: boolean;
    }): Promise<string | null> => {
        const user_id = crypto.randomUUID();
        const database_id = crypto.randomUUID();
        const { error } = await insert("admin_users", {
            user_id,
            auth_user_id: params.authUserId || null,
            user_name: params.userName,
            user_email: params.userEmail,
            user_admin_flag: 1,
            database_id,
            workspace_name: "My Workspace",
            dark_mode: 1,
        });
        if (error) {
            console.error("[userManager] createUser failed:", error);
            return null;
        }
        console.log(`✅ [UserManager] Created user: ${params.userName} (${user_id})`);
        return user_id;
    },

    // Update user — supports all mutable fields
    updateUser: async (userId: string, updates: Partial<User>): Promise<void> => {
        const data: Record<string, any> = {};
        if (updates.userName !== undefined) data.user_name = updates.userName;
        if (updates.userEmail !== undefined) data.user_email = updates.userEmail;
        if (updates.darkMode !== undefined) data.dark_mode = updates.darkMode ? 1 : 0;
        if (updates.workspaceName !== undefined) data.workspace_name = updates.workspaceName;
        if (updates.llmProvider !== undefined) data.llm_provider = updates.llmProvider;
        if (updates.llmModel !== undefined) data.llm_model = updates.llmModel;
        if (updates.chatVerbose !== undefined) data.chat_verbose = updates.chatVerbose ? 1 : 0;

        if (Object.keys(data).length > 0) {
            const { error } = await update("admin_users", { user_id: userId }, data);
            if (error) console.error("[userManager] updateUser:", error);
        }
    },

    // Delete user
    deleteUser: async (userId: string): Promise<void> => {
        const { error } = await del("admin_users", { user_id: userId });
        if (error) console.error("[userManager] deleteUser:", error);
        else console.log(`✅ [UserManager] Deleted user: ${userId}`);
    },

    // ── Targeted mutation helpers ─────────────────────────────────────────────

    /** Update workspace name */
    updateWorkspaceName: async (userId: string, name: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, { workspace_name: name });
        if (error) console.error("[userManager] updateWorkspaceName:", error);
    },

    /** Update LLM provider and model */
    updateLlmConfig: async (userId: string, provider: string, model: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            llm_provider: provider,
            llm_model: model,
        });
        if (error) console.error("[userManager] updateLlmConfig:", error);
    },

    /** Save encrypted API key */
    saveApiKey: async (userId: string, plainKey: string): Promise<void> => {
        const encrypted = encrypt(plainKey);
        const { error } = await update("admin_users", { user_id: userId }, {
            encrypted_llm_api_key: encrypted,
        });
        if (error) console.error("[userManager] saveApiKey:", error);
    },

    /** Clear API key */
    clearApiKey: async (userId: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            encrypted_llm_api_key: null,
        });
        if (error) console.error("[userManager] clearApiKey:", error);
    },

    /** Toggle dark mode — returns the new value */
    updateDarkMode: async (userId: string, enabled: boolean): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            dark_mode: enabled ? 1 : 0,
        });
        if (error) console.error("[userManager] updateDarkMode:", error);
    },

    /** Toggle chat verbosity (show process details in the chat stream) */
    updateChatVerbose: async (userId: string, enabled: boolean): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            chat_verbose: enabled ? 1 : 0,
        });
        if (error) console.error("[userManager] updateChatVerbose:", error);
    },

    /** Reset workspace (clear database_id and name) */
    resetWorkspace: async (userId: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            database_id: null,
            workspace_name: "My Workspace",
        });
        if (error) console.error("[userManager] resetWorkspace:", error);
    },

    /** Update last login timestamp */
    updateLastLogin: async (userId: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            last_login: new Date().toISOString(),
        });
        if (error) console.error("[userManager] updateLastLogin:", error);
    },

    /** Update auth_user_id (link external auth) */
    updateAuthUserId: async (userId: string, authUserId: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            auth_user_id: authUserId,
            last_login: new Date().toISOString(),
        });
        if (error) console.error("[userManager] updateAuthUserId:", error);
    },

    /** Update navigation context (current session/workflow/mode) */
    updateContext: async (userId: string, updates: {
        currentSessionId?: string | null;
        currentWorkflowId?: string | null;
        currentChatMode?: string | null;
    }): Promise<void> => {
        const data: Record<string, any> = {};
        if (updates.currentSessionId !== undefined) data.current_session_id = updates.currentSessionId;
        if (updates.currentWorkflowId !== undefined) data.current_workflow_id = updates.currentWorkflowId;
        if (updates.currentChatMode !== undefined) data.current_chat_mode = updates.currentChatMode;
        if (Object.keys(data).length === 0) return;
        const { error } = await update("admin_users", { user_id: userId }, data);
        if (error) console.error("[userManager] updateContext:", error);
    },

    /** Assign a database_id to a user that doesn't have one yet */
    assignDatabaseId: async (userId: string, databaseId: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            database_id: databaseId,
        });
        if (error) console.error("[userManager] assignDatabaseId:", error);
    },

    /** Update persona markdown */
    updatePersona: async (userId: string, markdown: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            persona_markdown: markdown,
        });
        if (error) console.error("[userManager] updatePersona:", error);
    },

    /** Save persona chat history */
    savePersonaChatHistory: async (userId: string, history: any[]): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            user_persona_chat_history: JSON.stringify(history),
        });
        if (error) console.error("[userManager] savePersonaChatHistory:", error);
    },

    /** Save a named secret */
    saveSecret: async (userId: string, name: string, value: string): Promise<void> => {
        const secrets = await readSecretsBlob(userId);
        const existing = secrets[name];
        secrets[name] = {
            value: value || existing?.value || "",
        };
        await writeSecretsBlob(userId, secrets);
    },

    /** Delete a named secret */
    deleteSecret: async (userId: string, name: string): Promise<void> => {
        const secrets = await readSecretsBlob(userId);
        delete secrets[name];
        await writeSecretsBlob(userId, secrets);
    },

    /** List secret names (never values) */
    listSecretNames: async (userId: string): Promise<string[]> => {
        return Object.keys(await readSecretsBlob(userId));
    },

    /** List secret names (with metadata) — for Settings UI and manifest. Never exposes values. */
    listSecrets: async (userId: string): Promise<Array<{ name: string }>> => {
        const secrets = await readSecretsBlob(userId);
        return Object.entries(secrets).map(([name]) => ({ name }));
    },

    /** Get a single secret value by name (decrypted) — returns just the key, not schema */
    getSecretValue: async (userId: string, name: string): Promise<string | null> => {
        const secrets = await readSecretsBlob(userId);
        return secrets[name]?.value ?? null;
    },

    /** Get secret values by database_id (for tool runtime) — returns { name: key } map */
    getSecretsByDatabaseId: async (databaseId: string): Promise<Record<string, string>> => {
        const { data, error } = await selectOne("admin_users", { database_id: databaseId }, "encrypted_secrets");
        if (error) return {};
        const secrets = parseSecretsBlob(data?.encrypted_secrets);
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(secrets)) result[k] = v.value;
        return result;
    },

    /** Get a single LLM provider API key (stored as llm_key_{provider} secret) */
    getLlmKey: async (userId: string, provider: string): Promise<string | undefined> => {
        const secretName = `llm_key_${provider}`;
        const secrets = await readSecretsBlob(userId);
        return secrets[secretName]?.value;
    },

    /** Save an LLM provider API key as llm_key_{provider} secret */
    saveLlmKey: async (userId: string, provider: string, plainKey: string): Promise<void> => {
        const secretName = `llm_key_${provider.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
        await userManager.saveSecret(userId, secretName, plainKey);
    },

    /** Delete an LLM provider API key */
    deleteLlmKey: async (userId: string, provider: string): Promise<void> => {
        const secretName = `llm_key_${provider}`;
        await userManager.deleteSecret(userId, secretName);
    },

    /** List providers that have user-configured LLM keys */
    listLlmKeys: async (userId: string): Promise<string[]> => {
        const secrets = await userManager.listSecrets(userId);
        return secrets
            .filter((s: any) => s.name.startsWith("llm_key_"))
            .map((s: any) => s.name.replace("llm_key_", ""));
    },

    /** Save dashboard chat history */
    saveDashboardChatHistory: async (userId: string, history: string): Promise<void> => {
        const { error } = await update("admin_users", { user_id: userId }, {
            dashboard_chat_history: history,
        });
        if (error) console.error("[userManager] saveDashboardChatHistory:", error);
    },

    /** Get user persona and workspace info (for LLM context) */
    getUserContext: async (userId: string): Promise<{
        persona_markdown: string | null;
        workspace_name: string | null;
    } | null> => {
        const { data, error } = await selectOne("admin_users", { user_id: userId }, "persona_markdown,workspace_name");
        if (error) { console.error("[userManager] getUserContext:", error); return null; }
        return data || null;
    },

    /** Get LLM config by database_id (for LLM call dispatch) */
    getLlmConfigByDatabaseId: async (databaseId: string): Promise<{
        llm_provider: string | null;
        llm_model: string | null;
        encrypted_llm_api_key: string | null;
        user_id: string | null;
    } | null> => {
        const { data, error } = await selectOne(
            "admin_users",
            { database_id: databaseId },
            "llm_provider,llm_model,encrypted_llm_api_key,user_id"
        );
        if (error) { console.error("[userManager] getLlmConfigByDatabaseId:", error); return null; }
        return data || null;
    },

    /** Update user's LLM provider and model preferences */
    updateLlmPreferences: async (userId: string, provider: string, model: string): Promise<void> => {
        await update("admin_users", { user_id: userId }, {
            llm_provider: provider,
            llm_model: model,
        });
    },

    /** Get the enabled skill group keys for a user (normalized, or [] if unset). */
    getSkillGroups: async (userId: string): Promise<string[]> => {
        const { data, error } = await selectOne("admin_users", { user_id: userId }, "skills_enabled");
        if (error || !data) return [];
        return parseEnabledSkillGroups(data.skills_enabled) ?? [];
    },

    /** Get the enabled skill group keys by database_id (for the tool runtime). */
    getSkillGroupsByDatabaseId: async (databaseId: string): Promise<string[]> => {
        const { data, error } = await selectOne("admin_users", { database_id: databaseId }, "skills_enabled");
        if (error || !data) return [];
        return parseEnabledSkillGroups(data.skills_enabled) ?? [];
    },

    /** Raw stored skill group keys by database_id — null when no preference is saved. */
    getStoredSkillGroupsByDatabaseId: async (databaseId: string): Promise<string[] | null> => {
        const { data, error } = await selectOne("admin_users", { database_id: databaseId }, "skills_enabled");
        if (error || !data || !data.skills_enabled) return null;
        return parseEnabledSkillGroups(data.skills_enabled) ?? [];
    },

    /** Persist the user's enabled skill group keys (normalized, deduped). */
    saveSkillGroups: async (userId: string, groupKeys: string[]): Promise<void> => {
        const keys = normalizeGroupKeys(groupKeys);
        const { error } = await update("admin_users", { user_id: userId }, {
            skills_enabled: keys.length > 0 ? JSON.stringify(keys) : null,
        });
        if (error) console.error("[userManager] saveSkillGroups:", error);
    },

    /** Get the user's visible nav section keys (normalized, or [] if unset). */
    getNavVisibility: async (userId: string): Promise<string[]> => {
        const { data, error } = await selectOne("admin_users", { user_id: userId }, "nav_enabled");
        if (error || !data) return [];
        return parseNavVisibility(data.nav_enabled) ?? [];
    },

    /** Raw stored nav visibility keys by database_id — null when no preference saved. */
    getStoredNavVisibilityByDatabaseId: async (databaseId: string): Promise<string[] | null> => {
        const { data, error } = await selectOne("admin_users", { database_id: databaseId }, "nav_enabled");
        if (error || !data || !data.nav_enabled) return null;
        return parseNavVisibility(data.nav_enabled) ?? [];
    },

    /** Persist the user's visible nav section keys (normalized, deduped). */
    saveNavVisibility: async (userId: string, keys: string[]): Promise<void> => {
        const normalized = normalizeNavKeys(keys);
        const { error } = await update("admin_users", { user_id: userId }, {
            nav_enabled: normalized.length > 0 ? JSON.stringify(normalized) : null,
        });
        if (error) console.error("[userManager] saveNavVisibility:", error);
    },

    /** Save a named secret by database_id (for tool runtime) */
    saveSecretByDatabaseId: async (databaseId: string, name: string, value: string): Promise<void> => {
        const { data, error: readErr } = await selectOne("admin_users", { database_id: databaseId }, "user_id,encrypted_secrets");
        if (readErr || !data) {
            console.error("[userManager] saveSecretByDatabaseId failed — no user found for databaseId:", databaseId, "error:", readErr);
            throw new Error(`Cannot save secret "${name}": no user found for databaseId ${databaseId}`);
        }
        const secrets = parseSecretsBlob(data.encrypted_secrets);
        secrets[name] = { value };
        const { error: writeErr } = await update("admin_users", { user_id: data.user_id }, { encrypted_secrets: encryptSecretsBlob(secrets) });
        if (writeErr) {
            console.error("[userManager] saveSecretByDatabaseId write failed:", writeErr);
            throw new Error(`Cannot save secret "${name}": ${JSON.stringify(writeErr)}`);
        }
        console.log(`[userManager] saveSecretByDatabaseId: saved "${name}" for databaseId=${databaseId} userId=${data.user_id}`);
    },

    /** Resolve the owning user_id for a workspace (workspace-scoped secrets).
     *  Returns null for blank (mem-*) or disk-local workspaces that have no
     *  `workspaces` row, in which case persistence no-ops and the secret stays
     *  in process memory only. */
    getUserIdForWorkspace: async (workspaceId: string): Promise<string | null> => {
        const { data, error } = await selectOne("workspaces", { workspace_id: workspaceId }, "user_id");
        if (error || !data?.user_id) return null;
        return data.user_id;
    },

    /** Get a single secret value by workspace_id (decrypted). */
    getSecretByWorkspaceId: async (workspaceId: string, name: string): Promise<string | null> => {
        const userId = await userManager.getUserIdForWorkspace(workspaceId);
        if (!userId) return null;
        const secrets = await readSecretsBlob(userId);
        return secrets[name]?.value ?? null;
    },

    /** Save a named secret by workspace_id (for tool runtime, e.g. QBO tokens). */
    saveSecretByWorkspaceId: async (workspaceId: string, name: string, value: string): Promise<void> => {
        const userId = await userManager.getUserIdForWorkspace(workspaceId);
        if (!userId) return;
        const secrets = await readSecretsBlob(userId);
        secrets[name] = { value };
        await writeSecretsBlob(userId, secrets);
    },

    /** Delete a named secret by workspace_id. */
    deleteSecretByWorkspaceId: async (workspaceId: string, name: string): Promise<void> => {
        const userId = await userManager.getUserIdForWorkspace(workspaceId);
        if (!userId) return;
        const secrets = await readSecretsBlob(userId);
        delete secrets[name];
        await writeSecretsBlob(userId, secrets);
    },

    // ── Beta credit (beta codes) ─────────────────────────────────────────────

    /**
     * Redeem a single-use beta code for a user. Atomically marks the code used
     * and increments the user's credit balance (server-side RPC).
     */
    redeemBetaCode: async (userId: string, code: string): Promise<{
        ok: boolean;
        creditUsd?: number;
        error?: string;
    }> => {
        const { data, error } = await rpc<any>("redeem_beta_code", {
            p_code: code,
            p_user_id: userId,
        });
        if (error) {
            console.error("[userManager] redeemBetaCode RPC error:", error);
            return { ok: false, error: "server_error" };
        }
        return data ?? { ok: false, error: "server_error" };
    },

    /**
     * Current credit status for a user: { balance, used } in USD.
     * `remaining = balance - used`.
     */
    getCreditStatus: async (userId: string): Promise<{ balance: number; used: number }> => {
        const { data, error } = await rpc<any>("credit_status", { p_user_id: userId });
        if (error || !data) {
            console.error("[userManager] getCreditStatus RPC error:", error);
            return { balance: 0, used: 0 };
        }
        return {
            balance: Number(data.balance ?? 0),
            used: Number(data.used ?? 0),
        };
    },

    /**
     * Usage time-buckets for the analytics panel. Returns one row per
     * (bucket, model) with spend, tokens, and request counts.
     */
    getUsageBuckets: async (
        userId: string,
        granularity: "day" | "month",
        since?: string,
        until?: string,
    ): Promise<UsageBucket[]> => {
        const { data, error } = await rpc<any>("usage_buckets", {
            p_user_id: userId,
            p_granularity: granularity,
            p_since: since || null,
            p_until: until || null,
        });
        if (error || !Array.isArray(data)) {
            console.error("[userManager] getUsageBuckets RPC error:", error);
            return [];
        }
        return data.map((r: any) => ({
            bucket: r.bucket,
            model: r.model ?? "",
            costUsd: Number(r.cost_usd ?? 0),
            inputTokens: Number(r.input_tokens ?? 0),
            outputTokens: Number(r.output_tokens ?? 0),
            requests: Number(r.requests ?? 0),
        }));
    },
};

function mapDbUserToDomain(row: any): User {
    const llmApiKey = row.encrypted_llm_api_key
        ? decrypt(row.encrypted_llm_api_key) || undefined
        : undefined;

    let secrets: Record<string, string> | undefined;
    if (row.encrypted_secrets) {
        const blob = parseSecretsBlob(row.encrypted_secrets);
        if (Object.keys(blob).length > 0) {
            secrets = {};
            for (const [k, v] of Object.entries(blob)) secrets[k] = v.value;
        }
    }

    return {
        userId: row.user_id,
        authUserId: row.auth_user_id || undefined,
        userEmail: row.user_email,
        userName: row.user_name,
        isAdmin: true, // solo: always admin
        isAuthenticated: false,
        currentDatabaseId: row.database_id || "",
        workspaceName: row.workspace_name || "My Workspace",
        darkMode: row.dark_mode === 1,
        llmApiKey,
        secrets,
        llmProvider: row.llm_provider || process.env.LLM_PROVIDER || "",
        llmModel: row.llm_model || process.env.LLM_MODEL || "",
        currentChatMode: row.current_chat_mode || "build",
        chatVerbose: row.chat_verbose !== 0,
        creditBalanceUsd: typeof row.credit_balance_usd === "number" ? row.credit_balance_usd : 0,
        skillsEnabled: parseEnabledSkillGroups(row.skills_enabled),
        navVisible: parseNavVisibility(row.nav_enabled),
        createdAt: row.created_at,
    };
}

/** Parse the stored skills_enabled column (JSON array or comma list) → group keys. */
function parseEnabledSkillGroups(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const keys = normalizeGroupKeys(parsed);
            return keys.length > 0 ? keys : undefined;
        }
    } catch {
        // fall through to comma-list parsing
    }
    const keys = normalizeGroupKeys(
        raw.split(",").map((s) => s.trim()).filter(Boolean),
    );
    return keys.length > 0 ? keys : undefined;
}

/** Parse the stored nav_enabled column (JSON array or comma list) → nav keys. */
function parseNavVisibility(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const keys = normalizeNavKeys(parsed);
            return keys.length > 0 ? keys : undefined;
        }
    } catch {
        // fall through to comma-list parsing
    }
    const keys = normalizeNavKeys(
        raw.split(",").map((s) => s.trim()).filter(Boolean),
    );
    return keys.length > 0 ? keys : undefined;
}
