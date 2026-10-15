import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { homeSiteRouter } from "../ui/pages/home/router";
import { sessionsRouter } from "../ui/pages/sessions/router";
import { authRouter } from "../ui/pages/auth/router";
import { userRouter } from "../ui/pages/user/router";
import { appRouter } from "../ui/pages/app/router";
import { designRouter } from "../ui/pages/design/router";
import { inboundRouter } from "./inbound/router";
import { cleanupExpiredShares } from "@backend/core/workspace/shareWorkflow";

import { validateUser } from "@frontend/pages/auth/getValidUser";
import type { User } from "@backend/types";
import { userManager } from "@backend/core/admin/userManager";
import { logError } from "@backend/core/logging/errorLogger";
import { EDITION, AUTH_MODE } from "@shared/edition";
import { hashPassword } from "@backend/core/crypto/hash";

const app = new Hono();

// Global error handler — log to structured file
app.onError((err, c) => {
  const user = c.get("user") as User | undefined;
  logError("http", err, {
    userId: user?.userId,
    context: { method: c.req.method, path: c.req.path },
  });
  console.error(`[Error] ${c.req.method} ${c.req.path}:`, err.message);
  return c.text("Internal Server Error", 500);
});

// Canonical domain middleware - redirect Render subdomain to custom domain.
// This service is the app, served at app.workflowpeople.com (the marketing
// apex/www is a separate static site).
app.use("*", async (c, next) => {
  const host = c.req.header("host");
  if (host?.includes("onrender.com")) {
    return c.redirect(`https://app.workflowpeople.com${c.req.path}`);
  }
  await next();
});

// USA-only geofence (Cloudflare). /inbound is exempt because cf-ipcountry there
// reflects Resend's server location, not the email sender.
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/inbound")) return next();
  const country = c.req.header("cf-ipcountry");
  if (country && country.toUpperCase() !== "US") {
    return c.text("Access Denied: Service only available in the United States.", 403);
  }
  await next();
});

// Static files
app.use("/public/*", serveStatic({ root: "./" }));

// Server-level favicon — browsers auto-fetch /favicon.svg from the site root
// when no <link rel="icon"> tag is present. Serves the W mark from
// public/img/favicon.svg (bg-free; see src/ui/components/logo.tsx).
app.get("/favicon.svg", async (c) => {
  const svg = await Bun.file("./public/img/favicon.svg").text();
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(svg);
});
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

// ─── Root → app ─────────────────────────────────────────────────────────────
// This service is the app only (marketing + the open-source runner live in the
// separate ai_wfp_site). The root bounces into /app, which redirects to the
// workspace shell (or the picker), gated by the auth middleware below.
app.get("/", (c) => c.redirect("/app"));

// Auth routes - must be mounted BEFORE auth middleware
app.route("/auth", authRouter);

// Inbound email webhook - public, signature-verified, mounted before auth.
app.route("/inbound", inboundRouter);

// Auth middleware - protect all routes except whitelisted paths
app.use("*", async (c, next) => {
  const path = c.req.path;

  c = await validateUser(c);
  const user = c.get("user") as User;

  const isWhitelisted =
    path.startsWith("/auth") ||
    path.startsWith("/public") ||
    path.startsWith("/api/contact") ||
    path.startsWith("/api/beta-request") ||
    path.startsWith("/inbound") ||
    path === "/favicon.svg" ||
    path === "/favicon.ico";

  if (!user.isAuthenticated && !isWhitelisted) {
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Redirect", "/auth/login");
      return c.text("Unauthorized", 401);
    }
    return c.redirect("/auth/login");
  }

  await next();
});

// Cache control middleware
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path.startsWith("/public") || path.startsWith("/auth")) {
    return next();
  }
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  await next();
});

// Logging middleware
app.use("*", async (c, next) => {
  console.log(`${new Date().toISOString()} - ${c.req.method} ${c.req.url}`);
  await next();
});

// Routes
app.route("/", homeSiteRouter);
app.route("/app", appRouter);
app.route("/sessions", sessionsRouter);
app.route("/user", userRouter);
app.route("/design-system", designRouter);
// workspace + workbook routes moved to /app/* (pages/app/router.tsx)

// Verify Supabase connection and pre-create admin user on startup
(async () => {
  if (!process.env.APP_SECRET) {
    throw new Error(
      "APP_SECRET is not set. Set a long, random APP_SECRET environment variable before starting the server.",
    );
  }

  console.log("[Startup] Verifying Supabase connection...");

  if (EDITION !== "local") {
    try {
      const ensureUser = async (email: string | undefined, isAdmin: boolean) => {
        const e = email?.trim();
        if (!e) return;
        const existing = await userManager.getUserByEmail(e);
        if (!existing) {
          await userManager.createUser({ userName: e.split("@")[0], userEmail: e, isAdmin });
          console.log(`[Startup] User pre-created: ${e}${isAdmin ? " (admin)" : ""}`);
        }
      };

      await ensureUser(process.env.ADMIN_USER, true);

      // AUTH=password bootstrap: hash ADMIN_PASSWORD into the admin user's
      // password_hash (only when absent), so a self-hosted enterprise install
      // can sign in with zero email/Google. Fails closed when AUTH=password is
      // active but no password is configured.
      if (AUTH_MODE === "password") {
        const adminEmail = process.env.ADMIN_USER?.trim();
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminEmail) {
          console.error(
            "[Startup] AUTH=password requires ADMIN_USER. Set ADMIN_USER and ADMIN_PASSWORD, then restart.",
          );
        } else if (!adminPassword) {
          console.warn(
            `[Startup] AUTH=password is active but ADMIN_PASSWORD is unset — no password will be set for "${adminEmail}". ` +
              "Set ADMIN_PASSWORD and restart, or run scripts/reset-password.ts.",
          );
        } else {
          const admin = await userManager.getUserByEmail(adminEmail);
          if (admin && !(await userManager.getPasswordHash(admin.userId))) {
            await userManager.setPasswordHash(admin.userId, await hashPassword(adminPassword));
            console.log(`[Startup] Password set for admin "${adminEmail}" (from ADMIN_PASSWORD).`);
          }
        }
      }

      // Test user bypass: ensure the TEST_USER account exists so sign-in works
      // without OAuth. Created as a normal (non-admin) test user. Off in prod
      // (env unset) — the request-time check in getValidUser.ts also blocks prod.
      const testUser = process.env.TEST_USER?.trim();
      if (testUser && testUser !== process.env.ADMIN_USER?.trim()) {
        await ensureUser(testUser, false);
      }

      // Legacy dev auth bypass alias — kept for backward compatibility.
      const bypassEmail = process.env.DEV_AUTH_BYPASS_EMAIL;
      if (bypassEmail && bypassEmail.trim() !== process.env.ADMIN_USER?.trim() && bypassEmail.trim() !== testUser) {
        await ensureUser(bypassEmail, false);
      }

      console.log("[Startup] Supabase connection verified");
    } catch (error) {
      console.error("[Startup] Supabase connection failed:", error);
    }
  } else {
    console.log("[Startup] EDITION=local — skipping Supabase (single-user, no auth).");
  }

  // Initialize MCP aggregator (QBO + App servers)
  try {
    const { initMcp } = await import("../mcp/init");
    await initMcp();
  } catch (error) {
    console.error("[Startup] MCP init failed:", error);
  }

  // Cleanup expired shared workflows on startup and every 6 hours.
  cleanupExpiredShares();
  setInterval(cleanupExpiredShares, 6 * 60 * 60 * 1000);
})();

export default {
  port: Number(process.env.PORT) || 3000,
  hostname: "0.0.0.0",
  fetch: (req: Request) => app.fetch(req),
  idleTimeout: 255,
};
