import { userManager } from "@backend/core/admin/userManager";
import { User } from "@backend/types";

/**
 * Get User Profile
 * Retrieves user account information from Supabase
 */
export const getUserProfile = async (userId: string): Promise<User | undefined> => {
    const user = await userManager.getUser(userId);
    return user || undefined;
};
