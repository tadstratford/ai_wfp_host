import { getUser as getBaseUser, getUserByUserId, getUserByEmail as getBaseUserByEmail } from "@backend/core/user/getUser";

/**
 * User Context Module — Solo Edition
 *
 * Single-user mode: the user always has full designer/admin access.
 * Authority enums are kept for code compatibility but always return max values.
 */

export enum WfAndChatAuthority {
    None = 0,
    Viewer = 1,
    Designer = 2
}

export enum WfMngmtAuthority {
    None = 0,
    Viewer = 1,
    Approver = 2
}

export enum PracticeMgmtAuthority {
    None = 0,
    Admin = 1
}

export interface UserContextData {
    // User identity
    userId: string;
    authUserId: string;
    userEmail: string;
    userName: string;
    isAdmin: 0 | 1;
    isAuthenticated: boolean;
    darkMode: boolean;

    // Current database context (permanent per-user database)
    currentDatabaseId: string;
    workspaceName: string;
    llmApiKey?: string;
    llmProvider: string;
    llmModel: string;
    currentChatMode: string;
    chatVerbose: boolean;
    navVisible?: string[];

    // Authority — always full in solo mode
    wfAndChat: WfAndChatAuthority;
    wfMngmt: WfMngmtAuthority;
    practiceMgmt: PracticeMgmtAuthority;
}

function toContextData(baseUser: NonNullable<Awaited<ReturnType<typeof getBaseUser>>>): UserContextData {
    return {
        userId: baseUser.userId,
        authUserId: baseUser.authUserId || "",
        userEmail: baseUser.userEmail,
        userName: baseUser.userName,
        isAdmin: 1,
        isAuthenticated: baseUser.isAuthenticated,
        darkMode: baseUser.darkMode || false,
        currentDatabaseId: baseUser.currentDatabaseId || "",
        workspaceName: baseUser.workspaceName || "My Workspace",
        llmApiKey: baseUser.llmApiKey,
        llmProvider: baseUser.llmProvider || process.env.LLM_PROVIDER || "",
        llmModel: baseUser.llmModel || process.env.LLM_MODEL || "",
        currentChatMode: baseUser.currentChatMode || "build",
        chatVerbose: baseUser.chatVerbose !== false,
        navVisible: baseUser.navVisible,
        // Solo: always full access
        wfAndChat: WfAndChatAuthority.Designer,
        wfMngmt: WfMngmtAuthority.Approver,
        practiceMgmt: PracticeMgmtAuthority.Admin,
    };
}

/**
 * Load full user context by auth provider ID (Google/magic link)
 */
export async function loadUserContext(
    authUserId: string,
    email?: string,
    name?: string
): Promise<UserContextData | null> {
    const baseUser = await getBaseUser(authUserId, email, name);
    return baseUser ? toContextData(baseUser) : null;
}

/**
 * Load full user context by internal userId (for session cookie lookup)
 */
export async function loadUserContextByUserId(
    userId: string
): Promise<UserContextData | null> {
    const baseUser = await getUserByUserId(userId);
    return baseUser ? toContextData(baseUser) : null;
}

/**
 * Load full user context by email (read-only). Used by the dev auth bypass.
 */
export async function loadUserContextByEmail(
    email: string
): Promise<UserContextData | null> {
    const baseUser = await getBaseUserByEmail(email);
    return baseUser ? toContextData(baseUser) : null;
}

/**
 * Create unauthenticated user context
 */
export function createUnauthenticatedUser(): UserContextData {
    return {
        userId: "",
        authUserId: "",
        userEmail: "",
        userName: "",
        isAdmin: 0,
        isAuthenticated: false,
        darkMode: false,
        currentDatabaseId: "",
        workspaceName: "",
        llmProvider: process.env.LLM_PROVIDER || "",
        llmModel: process.env.LLM_MODEL || "",
        currentChatMode: "build",
        chatVerbose: true,
        wfAndChat: WfAndChatAuthority.None,
        wfMngmt: WfMngmtAuthority.None,
        practiceMgmt: PracticeMgmtAuthority.None,
    };
}
