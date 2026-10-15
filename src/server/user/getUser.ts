import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";

/**
 * Get or Create User from Authentication — Solo Edition (Supabase)
 *
 * 1. Try to find user by auth_user_id
 * 2. If not found, try by email and link auth_user_id
 * 3. If still not found, create new user with a permanent database_id
 * 4. If user has no database_id, generate and save one now
 *
 * Handles the case where a user signs up with Google then tries magic link
 * (or vice versa) — the email lookup in step 2 catches this and links
 * the new auth method to the existing account.
 */
export const getUser = async (
    authUserId: string,
    email?: string,
    name?: string
): Promise<User | null> => {
    console.log(`🔍 [Auth] getUser called: authUserId=${authUserId}, email=${email}, name=${name}`);

    // 1. Try to find by auth_user_id
    let user = await userManager.getUserByAuthId(authUserId);
    console.log(`🔍 [Auth] Step 1 (by authId): ${user ? `found ${user.userEmail}` : "not found"}`);

    // 2. If not found by auth_user_id, try by email and link auth method
    if (!user && email) {
        user = await userManager.getUserByEmail(email);
        console.log(`🔍 [Auth] Step 2 (by email): ${user ? `found ${user.userId}` : "not found"}`);
        if (user) {
            // User exists with a different auth method — link this one
            await userManager.updateAuthUserId(user.userId, authUserId);
            user.authUserId = authUserId;
            console.log(`✅ [Auth] Linked new auth method for existing user: ${email} (${authUserId})`);
        }
    }

    // 3. If still not found, create new user — gated by the signup allowlist.
    //    Only whitelisted emails may create an account; everyone else is
    //    silently denied (the auth handler turns this into a friendly message).
    if (!user && email) {
        const allowed = await userManager.isEmailAllowed(email);
        if (!allowed) {
            console.warn(`⛔ [Auth] Signup blocked — ${email} is not on the signup allowlist`);
            return null;
        }

        const userName = name || email.split("@")[0];
        console.log(`🔍 [Auth] Step 3: creating new user — email=${email}, authId=${authUserId}`);
        const userId = await userManager.createUser({
            userName,
            userEmail: email,
            authUserId,
        });

        if (!userId) {
            // Insert failed — could be a race condition or constraint violation.
            // Try one more email lookup in case a concurrent request created the user.
            console.warn(`⚠️ [Auth] createUser failed for ${email}, retrying email lookup...`);
            user = await userManager.getUserByEmail(email);
            if (user) {
                await userManager.updateAuthUserId(user.userId, authUserId);
                user.authUserId = authUserId;
                console.log(`✅ [Auth] Found user on retry after create failure: ${email}`);
            } else {
                console.error(`❌ [Auth] Cannot create or find user: ${email} — INSERT failed and email lookup also returned nothing`);
                return null;
            }
        } else {
            // Fetch the newly created user
            user = await userManager.getUser(userId);
            if (user) {
                console.log(`✅ [Auth] Created new user: ${email} (db: ${user.currentDatabaseId})`);
            } else {
                console.error(`❌ [Auth] createUser returned ${userId} but getUser came back null — row may not have been persisted`);
            }
        }
    }

    if (!user) {
        console.error(`❌ [Auth] getUser returning null — all steps exhausted for authId=${authUserId}, email=${email}`);
        return null;
    }

    // 4. If existing user has no database_id, generate one now
    if (!user.currentDatabaseId) {
        const databaseId = crypto.randomUUID();
        await userManager.assignDatabaseId(user.userId, databaseId);
        user.currentDatabaseId = databaseId;
        console.log(`✅ [Auth] Assigned database_id to existing user: ${user.userEmail}`);
    }

    // Update last login
    await userManager.updateLastLogin(user.userId);

    // Mark as authenticated
    user.isAuthenticated = true;

    return user;
};

/**
 * Get user by userId (for session-based lookup)
 */
export const getUserByUserId = async (userId: string): Promise<User | null> => {
    const user = await userManager.getUser(userId);
    if (!user) return null;
    user.isAuthenticated = true;
    return user;
};

/**
 * Get an existing user by email (read-only — does NOT create or relink auth).
 * Used by the dev auth bypass; returns null if no such account exists.
 */
export const getUserByEmail = async (email: string): Promise<User | null> => {
    const user = await userManager.getUserByEmail(email);
    if (!user) return null;
    user.isAuthenticated = true;
    return user;
};
