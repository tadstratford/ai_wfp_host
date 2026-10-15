import { userManager } from "@backend/core/admin/userManager";
import { selectOne } from "@backend/core/admin/supabase";
import type { User } from "@backend/types";

/**
 * Database Access Context Management — Solo Edition (Supabase)
 * Tracks current session and workflow on admin_users directly.
 */

export interface DatabaseContext {
    userId: string;
    databaseId: string;
    currentSessionId: string | null;
    currentWorkflowId: string | null;
    currentChatMode: string | null;
    lastAccessed: Date;
}

/**
 * Get user's current context (session + workflow)
 */
export const getDatabaseContext = async (user: User): Promise<DatabaseContext | null> => {
    if (!user?.userId) return null;

    const { data, error } = await selectOne(
        "admin_users",
        { user_id: user.userId },
        "user_id,database_id,current_session_id,current_workflow_id,current_chat_mode,last_login"
    );

    if (error || !data) return null;

    return {
        userId: data.user_id,
        databaseId: data.database_id || "",
        currentSessionId: data.current_session_id || null,
        currentWorkflowId: data.current_workflow_id || null,
        currentChatMode: data.current_chat_mode || "build",
        lastAccessed: new Date(data.last_login || Date.now()),
    };
};

/**
 * Update user's database context
 */
export const updateDatabaseContext = async (
    user: User,
    updates: {
        currentSessionId?: string | null;
        currentWorkflowId?: string | null;
        currentChatMode?: string | null;
    }
): Promise<void> => {
    if (!user?.userId) return;
    await userManager.updateContext(user.userId, updates);
};

export const getCurrentSessionId = async (user: User): Promise<string | null> => {
    const ctx = await getDatabaseContext(user);
    return ctx?.currentSessionId || null;
};

export const setCurrentSessionId = async (user: User, sessionId: string): Promise<void> => {
    await updateDatabaseContext(user, { currentSessionId: sessionId });
};

export const getCurrentWorkflowId = async (user: User): Promise<string | null> => {
    const ctx = await getDatabaseContext(user);
    return ctx?.currentWorkflowId || null;
};

export const setCurrentWorkflowId = async (user: User, workflowId: string): Promise<void> => {
    await updateDatabaseContext(user, { currentWorkflowId: workflowId });
};

export const getCurrentChatMode = async (user: User): Promise<string> => {
    const ctx = await getDatabaseContext(user);
    return ctx?.currentChatMode || "build";
};

export const setCurrentChatMode = async (user: User, mode: string): Promise<void> => {
    await updateDatabaseContext(user, { currentChatMode: mode });
};

export const setChatVerbose = async (user: User, verbose: boolean): Promise<void> => {
    if (!user?.userId) return;
    await userManager.updateChatVerbose(user.userId, verbose);
};
