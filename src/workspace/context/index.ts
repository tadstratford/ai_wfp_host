/**
 * User Context Module
 * Single source of truth for user/database/authority context
 */

export {
    loadUserContext,
    loadUserContextByUserId,
    loadUserContextByEmail,
    createUnauthenticatedUser,
    WfAndChatAuthority,
    WfMngmtAuthority,
    PracticeMgmtAuthority,
    type UserContextData,
} from "./userContext";
