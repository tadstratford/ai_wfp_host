import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac } from "node:crypto";

const SESSION_COOKIE = "wfp_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getSecret(): string {
    const secret = process.env.APP_SECRET;
    if (!secret) {
        throw new Error(
            "APP_SECRET is not set. Set a long, random APP_SECRET environment variable before starting the server.",
        );
    }
    return secret;
}

/** Sign a payload string with HMAC-SHA256 */
function sign(payload: string): string {
    const sig = createHmac("sha256", getSecret()).update(payload).digest("hex");
    return `${payload}.${sig}`;
}

/** Verify and return the payload, or null if invalid */
function verify(signed: string): string | null {
    const lastDot = signed.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = signed.substring(0, lastDot);
    const expected = sign(payload);
    return expected === signed ? payload : null;
}

/** Create a session cookie for the given userId */
export function setSession(c: Context, userId: string): void {
    const value = sign(userId);
    setCookie(c, SESSION_COOKIE, value, {
        path: "/",
        maxAge: MAX_AGE,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
    });
}

/** Read and verify the session cookie, returning userId or null */
export function getSession(c: Context): string | null {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (!cookie) return null;
    return verify(cookie);
}

/** Clear the session cookie */
export function clearSession(c: Context): void {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
