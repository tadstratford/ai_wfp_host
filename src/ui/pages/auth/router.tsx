import { Hono } from "hono";
import {
    handleLogin,
    handleGoogleLogin,
    handleGoogleCallback,
    handleMagicLinkRequest,
    handleMagicLinkVerify,
    handlePasswordLogin,
    handleLogout,
    handleDevLogin,
    handleQBOInit,
    handleQBOCallback,
} from "./authHandlers";

export const authRouter = new Hono();

// Login page
authRouter.get("/login", handleLogin);

// Google OAuth
authRouter.get("/google", handleGoogleLogin);
authRouter.get("/callback/google", handleGoogleCallback);

// QBO OAuth
authRouter.get("/qbo", handleQBOInit);
authRouter.get("/callback/qbo", handleQBOCallback);

// Magic link
authRouter.post("/magic-link", handleMagicLinkRequest);
authRouter.get("/magic-link/verify", handleMagicLinkVerify);

// Password login (AUTH=password)
authRouter.post("/password", handlePasswordLogin);

// Dev-only backdoor — never registered in prod. Lets local dev + Playwright
// authenticate without Google or Resend configured.
if (process.env.NODE_ENV !== "production") {
    authRouter.get("/dev-login", handleDevLogin);
}

// Logout
authRouter.get("/logout", handleLogout);
authRouter.post("/logout", handleLogout);
