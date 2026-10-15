import { Hono } from "hono";
import { cors } from "hono/cors";
import { logPageView } from "@backend/core/admin/siteVisits";
import { sendContactEmail, sendBetaRequestEmail } from "@backend/core/email";

export const homeSiteRouter = new Hono();

// Track page views (prod only). The marketing pages are now static HTML and
// short-circuit before this router runs, so this only fires for the dynamic
// endpoints below — but we keep the hook in case future home endpoints want
// the same logging.
if (process.env.TRACK_VISITS === "true") {
  homeSiteRouter.use("*", async (c, next) => {
    const page = c.req.path || "??";
    const host = c.req.header("host") || "local";
    logPageView(page, host);
    await next();
  });
}

// ─── Contact form submit ────────────────────────────────────────────────────
// The static site posts here as application/x-www-form-urlencoded. Renders a
// tiny thank-you (or error) page inline so the form action works without JS.

const layoutShell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} — Workflow People</title>
<link rel="stylesheet" href="/public/css/tailwind.css" />
<link rel="stylesheet" href="/public/css/home.css" />
<script defer src="https://cloud.umami.is/script.js" data-website-id="e43ad1d1-221a-4e1e-8cc6-35d9ac64faff"></script>
</head>
<body class="bg-warm-50 min-h-screen flex items-center justify-center p-6">
<main class="max-w-md text-center">${body}</main>
</body></html>`;

// Beta-request responses use the NEW marketing design (brand blue / ink /
// Inter) so the thank-you page matches the marketing site (workflowpeople.com)
// instead of the legacy warm/brown theme that the contact form still uses.
const betaRequestShell = (opts: { ok: boolean; title: string; message: string }) => {
  const accent = opts.ok ? "#5CAA60" : "#DC4B4B";
  const glyph = opts.ok
    ? '<path d="M20 6 9 17l-5-5" />'
    : '<path d="M18 6 6 18M6 6l12 12" />';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${opts.title} — Workflow People</title>
<link rel="icon" type="image/svg+xml" href="/public/img/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #F3F5F9; color: #242E3D; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #ffffff; border: 1px solid #e5e9f0; border-radius: 16px; padding: 40px 32px; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 1px 3px rgba(36,46,61,.06); }
  .logo { height: 30px; width: auto; margin-bottom: 28px; }
  .badge { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${accent}; }
  .badge svg { width: 28px; height: 28px; }
  h1 { font-size: 1.25rem; font-weight: 700; color: #242E3D; margin-bottom: 8px; }
  p { font-size: .875rem; color: #6C7C94; line-height: 1.5; margin-bottom: 24px; }
  .btn { display: inline-block; padding: 12px 28px; background: #3E8DE1; color: #ffffff; border-radius: 10px; font-size: .9375rem; font-weight: 600; text-decoration: none; transition: background 0.15s; }
  .btn:hover { background: #2B7BCB; }
</style>
</head>
<body>
<div class="card">
  <img src="/public/img/wordmark-dark.svg" class="logo" alt="Workflow People" />
  <div class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></div>
  <h1>${opts.title}</h1>
  <p>${opts.message}</p>
  <a href="https://workflowpeople.com" class="btn">Back to home</a>
</div>
</body></html>`;
};

// CORS for the cross-origin form submit from the static marketing site.
// Plain form-nav POSTs don't strictly need CORS (the browser navigates to the
// action URL — no JS reads the response), but this future-proofs a fetch-based
// submit and handles OPTIONS preflight if anyone sets a non-simple Content-Type
// later. Allowed origins: the marketing apex (workflowpeople.com / www).
homeSiteRouter.use(
  "/api/contact",
  cors({
    origin: [
      "https://workflowpeople.com",
      "https://www.workflowpeople.com",
    ],
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

homeSiteRouter.use(
  "/api/beta-request",
  cors({
    origin: [
      "https://workflowpeople.com",
      "https://www.workflowpeople.com",
    ],
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

homeSiteRouter.post("/api/contact", async (c) => {
  try {
    const form = await c.req.parseBody();
    const name = (form.name as string)?.trim();
    const email = (form.email as string)?.trim();
    const message = (form.message as string)?.trim();

    if (!name || !email || !message) {
      return c.html(
        layoutShell(
          "Missing fields",
          `<h1 class="text-2xl font-semibold text-warm-800 mb-3">Missing fields</h1>
           <p class="text-gray-600 mb-6">Name, email, and message are all required.</p>
           <a href="/contact" class="inline-block px-5 py-2.5 rounded-lg bg-warm-700 hover:bg-warm-600 text-white text-sm font-medium">Back to the form</a>`,
        ),
        400,
      );
    }

    const result = await sendContactEmail({ name, email, message });
    if (!result.success) {
      return c.html(
        layoutShell(
          "Couldn't send",
          `<h1 class="text-2xl font-semibold text-warm-800 mb-3">That didn't go through</h1>
           <p class="text-gray-600 mb-6">${result.message}</p>
           <a href="/contact" class="inline-block px-5 py-2.5 rounded-lg bg-warm-700 hover:bg-warm-600 text-white text-sm font-medium">Try again</a>`,
        ),
        500,
      );
    }

    return c.html(
      layoutShell(
        "Message sent",
        `<h1 class="text-2xl font-semibold text-warm-800 mb-3">Thanks — got it.</h1>
         <p class="text-gray-600 mb-6">I'll reply from <strong>tad@workflowpeople.com</strong>. Usually within a day.</p>
         <a href="/" class="inline-block px-5 py-2.5 rounded-lg bg-warm-700 hover:bg-warm-600 text-white text-sm font-medium">Back to home</a>`,
      ),
    );
  } catch (err: any) {
    console.error("[Contact] error:", err);
    return c.html(
      layoutShell(
        "Error",
        `<h1 class="text-2xl font-semibold text-warm-800 mb-3">Something went wrong</h1>
         <p class="text-gray-600 mb-6">An unexpected error occurred. Please try again or email tad@workflowpeople.com directly.</p>
         <a href="/contact" class="inline-block px-5 py-2.5 rounded-lg bg-warm-700 hover:bg-warm-600 text-white text-sm font-medium">Back to the form</a>`,
      ),
      500,
    );
  }
});

// ─── Beta access / demo request ─────────────────────────────────────────────
// The static site posts here as application/x-www-form-urlencoded. Emails the
// operator via Resend; they then allowlist the email and hand out a beta code.

homeSiteRouter.post("/api/beta-request", async (c) => {
  try {
    const form = await c.req.parseBody();
    const email = (form.email as string)?.trim();
    const name = (form.name as string)?.trim() || email?.split("@")[0] || "Work email";
    const company = (form.company as string)?.trim();
    const message = (form.message as string)?.trim();

    if (!email || !email.includes("@")) {
      return c.html(
        betaRequestShell({
          ok: false,
          title: "Missing fields",
          message: "A valid work email is required.",
        }),
        400,
      );
    }

    const result = await sendBetaRequestEmail({ name, email, company, message });
    if (!result.success) {
      return c.html(
        betaRequestShell({
          ok: false,
          title: "That didn't go through",
          message: result.message,
        }),
        500,
      );
    }

    return c.html(
      betaRequestShell({
        ok: true,
        title: "You're on the list",
        message: "Thanks! I'll be in touch with access and updates.",
      }),
    );
  } catch (err: any) {
    console.error("[BetaRequest] error:", err);
    return c.html(
      betaRequestShell({
        ok: false,
        title: "Something went wrong",
        message: "An unexpected error occurred. Please try again or email tad@workflowpeople.com directly.",
      }),
      500,
    );
  }
});
