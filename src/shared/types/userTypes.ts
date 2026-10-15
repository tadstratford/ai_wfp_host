/**
 * User Type Definition — Solo Edition
 */
export interface User {
    userId: string;
    authUserId?: string;
    userEmail: string;
    userName: string;
    isAdmin: boolean;
    isAuthenticated: boolean;
    currentDatabaseId: string;   // permanent per-user database UUID
    workspaceName: string;       // human-readable workspace name (from admin_users)
    darkMode: boolean;
    llmApiKey?: string;          // decrypted at load time, never persisted beyond request
    secrets?: Record<string, string>; // decrypted named secrets (e.g. API keys for external services)
    llmProvider: string;         // 'anthropic' | 'together' | 'openai' | 'google' | 'ollama'
    llmModel: string;            // model ID e.g. 'claude-sonnet-4-6'
    currentChatMode: string;     // 'plan' | 'build' — persisted chat mode
    chatVerbose: boolean;        // show process details (LLM/tool/meta) in chat stream
    creditBalanceUsd?: number;   // total credit granted via beta codes
    skillsEnabled?: string[];    // enabled skill group keys (see @shared/skillGroups)
    navVisible?: string[];       // visible nav section keys (see @shared/navItems)
    createdAt?: Date | string;

    // Authority fields — kept for code compatibility; always full access in solo
    wfAndChat?: number;
    wfMngmt?: number;
    practiceMgmt?: number;
    permissions?: {
        wfChatDesigner: boolean;
        wfChatViewer: boolean;
        wfMgmtApprover: boolean;
        wfMgmtViewer: boolean;
        practiceMgmtAdmin: boolean;
    };
}
