import { userManager } from "./userManager";
import { selectOne } from "./supabase";
import type { ClaudeMessage } from "@backend/core/models/types";

export interface UserWithPersona {
    user_id: string;
    user_name: string;
    persona_markdown?: string;
    user_persona_chat_history?: string;
}

export const getUserWithPersona = async (userId: string): Promise<UserWithPersona | null> => {
    const { data, error } = await selectOne(
        "admin_users",
        { user_id: userId },
        "user_id,user_name,persona_markdown,user_persona_chat_history"
    );
    if (error || !data) return null;
    return data as UserWithPersona;
};

export const updateUserPersona = async (userId: string, markdown: string): Promise<void> => {
    await userManager.updatePersona(userId, markdown);
    console.log(`✅ [UserPersonaManager] Updated persona for user ${userId}`);
};

export const saveUserPersonaChatHistory = async (
    userId: string,
    history: ClaudeMessage[]
): Promise<void> => {
    await userManager.savePersonaChatHistory(userId, history);
};
