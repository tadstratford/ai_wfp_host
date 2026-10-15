/**
 * Authentication and Authorization Type Definitions — Solo Edition
 */

export interface UserPermissions {
    wfChatDesigner: boolean;
    wfChatViewer: boolean;
    wfMgmtApprover: boolean;
    wfMgmtViewer: boolean;
    practiceMgmtAdmin: boolean;
}
