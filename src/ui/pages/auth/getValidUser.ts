import type { Context } from "hono";
import { getSession } from "./session";
import { EDITION } from "@shared/edition";
import { localUserContext } from "@backend/core/user/localIdentity";
import {
    loadUserContextByUserId,
    loadUserContextByEmail,
    createUnauthenticatedUser,
    type UserContextData,
} from "@backend/core/context";

/**
 * Validate User and Load Complete Context
 *
 * Reads signed session cookie → loads user from admin_users.
 * Returns unauthenticated user if no valid session.
 *
 * Dev auth bypass: when there is no valid session AND a dev flag is set, sign in
 * as an existing account by email without OAuth. See `devBypassContext`. This is
 * OFF unless the env var is set, and must never be enabled in production.
 */
export const validateUser = async (c: Context): Promise<Context> => {
    // EDITION=local is single-user with no auth — every request runs as the
    // fixed local user (AUTH=none). No cookie, no Supabase identity lookup.
    if (EDITION === "local") {
        c.set("user", localUserContext());
        return c;
    }

    try {
        const userId = getSession(c);
        if (userId) {
            const userContext = await loadUserContextByUserId(userId);
            if (userContext) {
                c.set("user", userContext);
                return c;
            }
        }

        // No valid session → dev bypass (if enabled), else unauthenticated.
        const bypass = await devBypassContext();
        c.set("user", bypass ?? createUnauthenticatedUser());
        return c;
    } catch (error) {
        console.error("[Auth] Validation error:", error);
        c.set("user", createUnauthenticatedUser());
        return c;
    }
};

// ── Dev auth bypass (LOCAL DEVELOPMENT ONLY) ─────────────────────────────────
// Sign in as a fixed email on every request, with no OAuth/magic-link required.
// Enable by setting ONE of:
//   TEST_USER=you@example.com                  (preferred — explicit test user)
//   DEV_AUTH_BYPASS_EMAIL=you@example.com     (legacy alias)
//   DEV_AUTH_BYPASS=1                          (uses the ADMIN_USER email)
// The account must already exist (sign in once via OAuth to create it). When
// unset (or NODE_ENV=production), this returns null and normal auth is enforced.
// There is NO default — if the env var is missing, the bypass is fully disabled.
let warnedBypass = false;

async function devBypassContext(): Promise<UserContextData | null> {
    if (process.env.NODE_ENV === "production") return null;

    const email =
        process.env.TEST_USER?.trim() ||
        process.env.DEV_AUTH_BYPASS_EMAIL?.trim() ||
        (process.env.DEV_AUTH_BYPASS === "1" ? process.env.ADMIN_USER?.trim() : "");
    if (!email) return null;

    const source = process.env.TEST_USER
        ? "TEST_USER"
        : process.env.DEV_AUTH_BYPASS_EMAIL
            ? "DEV_AUTH_BYPASS_EMAIL"
            : "DEV_AUTH_BYPASS";

    const user = await loadUserContextByEmail(email);
    if (!user) {
        if (!warnedBypass) {
            console.warn(
                `[Auth] ${source} requested for "${email}" but no admin_users row exists — ` +
                `sign in once via OAuth to create it, then the bypass will work.`,
            );
            warnedBypass = true;
        }
        return null;
    }

    if (!warnedBypass) {
        console.warn(
            `[Auth] ⚠️  AUTH BYPASS ACTIVE (${source}) — every request is signed in as "${email}" ` +
            `without authentication. NEVER set TEST_USER/DEV_AUTH_BYPASS_* in production.`,
        );
        warnedBypass = true;
    }
    return user;
}
