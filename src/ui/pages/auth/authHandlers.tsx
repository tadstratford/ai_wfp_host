import { Context } from "hono";
import { createHmac } from "node:crypto";
import { setSession, clearSession, getSecret } from "./session";
import { validateUser } from "./getValidUser";
import { loadUserContext, loadUserContextByEmail } from "@backend/core/context";
import { userManager } from "@backend/core/admin/userManager";
import { LoginPage } from "./loginPage";
import { clearAllUserData } from "@backend/core/user-data/index";
import { clearQboTokensFromMemory, resolveQboScope } from "@capabilities/qbo/client";
import type { User } from "@backend/types";
import { logActivity } from "@backend/core/models/activityTracker";
import { SERVER_NAME } from "@backend/core/settings/instanceConfig";
import { EDITION } from "@shared/edition";
import { verifyPassword } from "@backend/core/crypto/hash";
import { checkLoginRateLimit, recordLoginFailure } from "@shared/auth/loginRateLimiter";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseUrl(c: Context): string {
    const proto = c.req.header("x-forwarded-proto") || "http";
    const host = c.req.header("host") || `localhost:${process.env.PORT || 3000}`;
    return `${proto}://${host}`;
}

function signToken(payload: string): string {
    const secret = getSecret();
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}.${sig}`;
}

function verifyToken(token: string): string | null {
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = token.substring(0, lastDot);
    const expected = signToken(payload);
    return expected === token ? payload : null;
}

// ─── Login Page ─────────────────────────────────────────────────────────────

export const handleLogin = async (c: Context) => {
    if (EDITION === "local") return c.redirect("/app");
    const error = c.req.query("error");
    const message = c.req.query("message");
    return c.html(<LoginPage error={error} message={message} />);
};

// ─── Google OAuth ───────────────────────────────────────────────────────────

export const handleGoogleLogin = async (c: Context) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return c.redirect("/auth/login?error=Google+OAuth+not+configured");
    }

    const redirectUri = `${getBaseUrl(c)}/auth/callback/google`;
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "online",
        prompt: "select_account",
    });

    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

export const handleGoogleCallback = async (c: Context) => {
    const code = c.req.query("code");
    const error = c.req.query("error");

    if (error || !code) {
        console.error("[Auth] Google callback error:", error);
        return c.redirect("/auth/login?error=Google+login+failed");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${getBaseUrl(c)}/auth/callback/google`;

    try {
        // Exchange code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: clientId!,
                client_secret: clientSecret!,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error("[Auth] Google token exchange failed:", err);
            return c.redirect("/auth/login?error=Google+login+failed");
        }

        const tokens = (await tokenRes.json()) as { access_token: string };

        // Get user info
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        if (!userRes.ok) {
            console.error("[Auth] Google userinfo failed");
            return c.redirect("/auth/login?error=Could+not+get+user+info");
        }

        const googleUser = (await userRes.json()) as {
            id: string;
            email: string;
            name: string;
        };

        // Load or create user in admin_users
        const authId = `google_${googleUser.id}`;
        const userContext = await loadUserContext(authId, googleUser.email, googleUser.name);

        if (!userContext) {
            console.error(`❌ [Auth] Google: loadUserContext returned null for ${googleUser.email} (${authId})`);
            const allowed = await userManager.isEmailAllowed(googleUser.email);
            const msg = allowed
                ? "Account+setup+failed.+Please+try+again+or+use+a+different+sign-in+method."
                : "This+email+isn't+approved+for+beta+access+yet.+Request+access+on+the+homepage+and+we'll+get+back+to+you.";
            return c.redirect(`/auth/login?error=${msg}`);
        }

        // Set session cookie and redirect to app
        setSession(c, userContext.userId);
        logActivity(googleUser.email, "login", "google", userContext.userId);
        console.log(`✅ [Auth] Google login: ${googleUser.email}`);
        return c.redirect("/app");
    } catch (err) {
        console.error("[Auth] Google callback error:", err);
        return c.redirect("/auth/login?error=Google+login+failed");
    }
};

// ─── Magic Link ─────────────────────────────────────────────────────────────

export const handleMagicLinkRequest = async (c: Context) => {
    const body = await c.req.parseBody();
    const email = (body.email as string || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
        return c.redirect("/auth/login?error=Please+enter+a+valid+email");
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@workflowpeople.com";

    if (!resendKey) {
        return c.redirect("/auth/login?error=Email+sending+not+configured");
    }

    // Create a signed token: email|expiry (15 min)
    const expiry = Date.now() + 15 * 60 * 1000;
    const payload = `${email}|${expiry}`;
    const token = signToken(payload);
    const encodedToken = encodeURIComponent(token);

    const verifyUrl = `${getBaseUrl(c)}/auth/magic-link/verify?token=${encodedToken}`;

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${resendKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: fromEmail,
                to: email,
                subject: "Your Workflow People login link",
                html: `
                    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Sign in to Workflow People</h2>
                        <p style="color: #555; margin-bottom: 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
                        <a href="${verifyUrl}"
                           style="display: inline-block; background: #3b82f6; color: white; padding: 12px 32px;
                                  border-radius: 6px; text-decoration: none; font-weight: 500;">
                            Sign In
                        </a>
                        <p style="color: #999; font-size: 13px; margin-top: 32px;">
                            If you didn't request this link, you can safely ignore this email.
                        </p>
                    </div>
                `,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.error("[Auth] Resend error:", err);
            return c.redirect("/auth/login?error=Could+not+send+email");
        }

        console.log(`📧 [Auth] Magic link sent to: ${email}`);
        return c.redirect("/auth/login?message=Check+your+email+for+a+login+link");
    } catch (err) {
        console.error("[Auth] Magic link send error:", err);
        return c.redirect("/auth/login?error=Could+not+send+email");
    }
};

// ─── Password Login (AUTH=password) ─────────────────────────────────────────

function clientIp(c: Context): string {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return c.req.header("x-real-ip")?.trim() || "unknown";
}

export const handlePasswordLogin = async (c: Context) => {
    const body = await c.req.parseBody();
    const email = (body.email as string || "").trim().toLowerCase();
    const password = (body.password as string || "");
    const ip = clientIp(c);

    if (!email || !email.includes("@") || !password) {
        return c.redirect("/auth/login?error=Enter+your+email+and+password");
    }

    const limit = checkLoginRateLimit(email, ip);
    if (!limit.allowed) {
        return c.redirect(`/auth/login?error=${encodeURIComponent(limit.message || "Too+many+login+attempts")}`);
    }

    const hash = await userManager.getPasswordHashByEmail(email);
    if (!hash || !(await verifyPassword(password, hash))) {
        recordLoginFailure(email, ip);
        return c.redirect("/auth/login?error=Invalid+email+or+password");
    }

    const userContext = await loadUserContextByEmail(email);
    if (!userContext) {
        return c.redirect("/auth/login?error=Account+not+found");
    }

    setSession(c, userContext.userId);
    logActivity(email, "login", "password", userContext.userId);
    console.log(`✅ [Auth] Password login: ${email}`);
    return c.redirect("/app");
};

export const handleMagicLinkVerify = async (c: Context) => {
    const token = c.req.query("token");

    if (!token) {
        return c.redirect("/auth/login?error=Invalid+link");
    }

    const payload = verifyToken(decodeURIComponent(token));
    if (!payload) {
        return c.redirect("/auth/login?error=Invalid+or+expired+link");
    }

    const [email, expiryStr] = payload.split("|");
    const expiry = parseInt(expiryStr, 10);

    if (!email || isNaN(expiry) || Date.now() > expiry) {
        return c.redirect("/auth/login?error=Link+has+expired");
    }

    // Load or create user by email
    const authId = `email_${email}`;
    const userContext = await loadUserContext(authId, email, email.split("@")[0]);

    if (!userContext) {
        console.error(`❌ [Auth] Magic link: loadUserContext returned null for ${email} (${authId})`);
        const allowed = await userManager.isEmailAllowed(email);
        const msg = allowed
            ? "Account+setup+failed.+Please+try+again+or+use+a+different+sign-in+method."
            : "This+email+isn't+approved+for+beta+access+yet.+Request+access+on+the+homepage+and+we'll+get+back+to+you.";
        return c.redirect(`/auth/login?error=${msg}`);
    }

    setSession(c, userContext.userId);
    logActivity(email, "login", "magic_link", userContext.userId);
    console.log(`✅ [Auth] Magic link login: ${email}`);
    return c.redirect("/app");
};

// ─── Dev-only login backdoor ────────────────────────────────────────────────
// Only registered when NODE_ENV !== "production" (see router.tsx). Lets
// local dev + Playwright tests get a session without configuring Google or
// Resend. Creates the user record on first call via loadUserContext, same
// path the magic-link verify uses after token validation.
//
//   GET /auth/dev-login?email=test@local         → sets cookie, redirects to /app
//   GET /auth/dev-login?email=test@local&json=1  → returns {ok:true, userId, email}
//
// The handler itself re-checks NODE_ENV as belt-and-braces. If someone
// accidentally registers this in prod, requests still 404.

export const handleDevLogin = async (c: Context) => {
    if (process.env.NODE_ENV === "production") {
        return c.notFound();
    }

    const email = (c.req.query("email") || "dev@local").trim().toLowerCase();
    if (!email.includes("@")) {
        return c.json({ error: "email must be a valid address" }, 400);
    }

    const authId = `dev_${email}`;
    const userContext = await loadUserContext(authId, email, email.split("@")[0]);
    if (!userContext) {
        return c.json({ error: `loadUserContext returned null for ${email}` }, 500);
    }

    setSession(c, userContext.userId);
    console.log(`🔓 [Auth] dev-login: ${email} (${userContext.userId})`);

    if (c.req.query("json")) {
        return c.json({ ok: true, userId: userContext.userId, email });
    }
    return c.redirect("/app");
};

// ─── QBO OAuth ───────────────────────────────────────────────────────────────

export const handleQBOInit = async (c: Context) => {
  await validateUser(c);
  const user = c.get("user") as User | undefined;
  if (!user?.currentDatabaseId) return c.redirect("/auth/login?error=Not+authenticated");

  const baseUrl = process.env.QBO_REDIRECT_BASE || `${c.req.header("x-forwarded-proto") || "http"}://${c.req.header("host") || `localhost:${process.env.PORT || 3000}`}`;
  const redirectUri = `${baseUrl}/auth/callback/qbo`;
  const state = Buffer.from(JSON.stringify({
    databaseId: user.currentDatabaseId,
    userId: user.userId,
    scope: resolveQboScope(user.currentDatabaseId),
  })).toString("base64");

  const { qboOAuthUrl } = await import("@capabilities/qbo/client");
  return c.redirect(qboOAuthUrl(redirectUri, state));
};

function QboCallbackPage(props: { ok: boolean; title: string; message: string; detail?: string }) {
  const { ok, title, message, detail } = props;
  const accent = ok ? "#2CA01C" : "#dc4b4b";

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} — {SERVER_NAME}</title>
        <link rel="icon" type="image/svg+xml" href="/public/img/favicon.svg" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: #f3f5f9;
            color: #242e3d;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .card {
            background: #ffffff;
            border: 1px solid #e5e9f0;
            border-radius: 16px;
            padding: 40px 32px;
            width: 100%;
            max-width: 420px;
            text-align: center;
            box-shadow: 0 1px 3px rgba(36,46,61,.06);
          }
          .logo { height: 30px; width: auto; margin-bottom: 28px; }
          .badge {
            width: 56px;
            height: 56px;
            margin: 0 auto 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            background: ${accent};
          }
          .badge svg { width: 28px; height: 28px; }
          h1 { font-size: 1.25rem; font-weight: 700; color: #242e3d; margin-bottom: 8px; }
          .message { font-size: 0.875rem; color: #6c7c94; line-height: 1.5; margin-bottom: 8px; }
          .detail {
            font-family: ui-monospace, 'SF Mono', monospace;
            font-size: 0.75rem;
            color: #93a1b6;
            word-break: break-all;
            margin-bottom: 24px;
          }
          .btn {
            display: inline-block;
            padding: 12px 28px;
            background: ${accent};
            color: #ffffff;
            border: none;
            border-radius: 10px;
            font-size: 0.9375rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            transition: filter 0.15s, transform 0.1s;
          }
          .btn:hover { filter: brightness(0.95); }
          .btn:active { transform: scale(0.98); }
        `}</style>
      </head>
      <body>
        <div class="card">
          <img src="/public/img/wordmark-dark.svg" class="logo" alt={SERVER_NAME} />
          <div class="badge">
            {ok ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            )}
          </div>
          <h1>{title}</h1>
          <p class="message">{message}</p>
          {detail && <p class="detail">{detail}</p>}
          <a href="/app" class="btn">{ok ? "Return to app" : "Back to app"}</a>
        </div>
        {ok && (
          <script>{`try { if (window.opener) { window.opener.postMessage("qbo-connected", "*"); window.close(); } } catch (e) {}`}</script>
        )}
      </body>
    </html>
  );
}

export const handleQBOCallback = async (c: Context) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const stateRaw = c.req.query("state");
  const realmId = c.req.query("realmId");

  if (error || !code || !stateRaw || !realmId) {
    console.error("[QBO] OAuth error or missing params:", error);
    return c.html(
      <QboCallbackPage
        ok={false}
        title="Connection Failed"
        message={error || "Missing required parameters from Intuit."}
      />,
    );
  }

  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64").toString());
    const databaseId: string = state.databaseId;
    const scope: string = state.scope ?? databaseId;
    console.log(`[QBO] OAuth callback: databaseId=${databaseId}, scope=${scope}, realmId=${realmId}`);

    const baseUrl = process.env.QBO_REDIRECT_BASE || `${c.req.header("x-forwarded-proto") || "http"}://${c.req.header("host") || `localhost:${process.env.PORT || 3000}`}`;
    const redirectUri = `${baseUrl}/auth/callback/qbo`;

    const { qboExchangeCode, getQboTokens } = await import("@capabilities/qbo/client");
    await qboExchangeCode(code, redirectUri, realmId, scope);

    console.log(`✅ [QBO] Connected: realmId=${realmId} scope=${scope}`);
    const tokens = getQboTokens(scope);
    return c.html(
      <QboCallbackPage
        ok={true}
        title="QuickBooks Connected"
        message={tokens?.company_name ? `Your QuickBooks company "${tokens.company_name}" is now connected.` : "Your QuickBooks company is now connected."}
        detail={`Company ID: ${realmId}`}
      />,
    );
  } catch (err: any) {
    console.error("[QBO] Callback error:", err);
    return c.html(
      <QboCallbackPage
        ok={false}
        title="Connection Failed"
        message={err.message || "Something went wrong. Please try again."}
      />,
    );
  }
};

// ─── Logout ─────────────────────────────────────────────────────────────────

export const handleLogout = async (c: Context) => {
    if (EDITION === "local") return c.redirect("/app");
    // Close any active WorkspaceSession (M10) and clear ephemeral data
    // before destroying the auth cookie.
    //
    // /auth/* is mounted BEFORE the auth middleware (see frontend/index.tsx),
    // so c.get("user") is not populated here. Resolve it from the session
    // cookie ourselves — otherwise the in-memory workspace session is never
    // closed and a re-login reuses it (reopening the last workspace).
    try {
        await validateUser(c);
        const user = c.get("user") as User | undefined;
        // Resolve the QBO scope BEFORE closing the workspace session, since the
        // session is what maps the user's databaseId to their active workspace.
        const qboScope = user?.currentDatabaseId
            ? resolveQboScope(user.currentDatabaseId)
            : null;
        if (user?.userId) {
            const { closeActiveWorkspace } = await import(
                "@backend/core/workspace/workspaceLifecycle"
            );
            await closeActiveWorkspace(user.userId, "logout");
        }
        if (user?.currentDatabaseId) {
            await clearAllUserData(user.currentDatabaseId);
            // Drop the workspace's in-memory QBO tokens for hygiene, but keep the
            // persisted secret so the connection silently re-hydrates next login.
            if (qboScope) clearQboTokensFromMemory(qboScope);
            console.log("🧹 [Auth] Cleared ephemeral data on logout");
        }
        if (user?.userEmail) {
            logActivity(user.userEmail, "logout", undefined, user.userId);
        }
    } catch {
        // user context may not be available, that's ok
    }

    clearSession(c);
    console.log("👋 [Auth] User logged out");
    return c.redirect("/auth/login");
};
