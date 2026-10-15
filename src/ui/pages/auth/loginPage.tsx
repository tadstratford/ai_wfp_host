export const LoginPage = ({ error, message }: { error?: string; message?: string }) => {
    const hasGoogle = !!process.env.GOOGLE_CLIENT_ID;
    const hasMagic = !!process.env.RESEND_API_KEY;

    const inputCls =
        "w-full rounded-xl border border-ink/[0.12] bg-[#F3F5F9] px-3 py-2 text-sm text-ink placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 transition";
    const labelCls = "block text-sm font-semibold text-ink-700 mb-1.5";

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Sign In — Workflow People</title>
                <link rel="icon" type="image/svg+xml" href="/public/img/favicon.svg" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
                <link rel="stylesheet" href="/public/css/tailwind.css" />
                <script defer src="https://cloud.umami.is/script.js" data-website-id="e43ad1d1-221a-4e1e-8cc6-35d9ac64faff"></script>
            </head>
            <body class="min-h-screen flex items-center justify-center p-6 bg-[#F3F5F9] text-ink">
                <div class="bg-white border border-ink/[0.08] rounded-xl shadow-sm p-8 w-full max-w-sm">
                    <img src="/public/img/wordmark-dark.svg" class="h-8 block mb-8" alt="Workflow People" />
                    <h1 class="text-xl font-bold tracking-tight text-ink mb-1">Welcome back</h1>
                    <p class="text-sm text-ink-500 mb-8">Sign in to your Workflow People account</p>

                    {error && (
                        <div class="flex items-center gap-2 rounded-lg border border-coral-200 bg-coral-50 text-coral-600 px-3 py-2 text-sm mb-5">
                            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 8v4M12 16h.01" />
                            </svg>
                            <span>{decodeURIComponent(error.replace(/\+/g, " "))}</span>
                        </div>
                    )}
                    {message && (
                        <div class="flex items-center gap-2 rounded-lg border border-leaf-100 bg-leaf-50 text-leaf-700 px-3 py-2 text-sm mb-5">
                            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <path d="M22 4 12 14.01l-3-3" />
                            </svg>
                            <span>{decodeURIComponent(message.replace(/\+/g, " "))}</span>
                        </div>
                    )}

                    {hasGoogle && (
                        <a href="/auth/google" class="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 no-underline transition">
                            <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Sign in with Google
                        </a>
                    )}

                    {hasGoogle && (
                        <div class="flex items-center gap-3 mt-6 mb-6 text-xs font-medium text-ink-400">
                            <span class="flex-1 border-t border-ink/[0.1]"></span>
                            or
                            <span class="flex-1 border-t border-ink/[0.1]"></span>
                        </div>
                    )}
                    <form action="/auth/password" method="POST">
                        <label for="email" class={labelCls}>Email address</label>
                        <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email" class={inputCls} />
                        <label for="password" class={labelCls + " mt-4"}>Password</label>
                        <input type="password" id="password" name="password" placeholder="Your password" required autocomplete="current-password" class={inputCls} />
                        <button type="submit" class="w-full rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition mt-5">Sign in with password</button>
                    </form>

                    {hasMagic && (
                        <>
                            <div class="flex items-center gap-3 mt-6 mb-6 text-xs font-medium text-ink-400">
                                <span class="flex-1 border-t border-ink/[0.1]"></span>
                                or
                                <span class="flex-1 border-t border-ink/[0.1]"></span>
                            </div>
                            <form action="/auth/magic-link" method="POST">
                                <label for="magic-email" class={labelCls}>Email address</label>
                                <input type="email" id="magic-email" name="email" placeholder="you@example.com" required autocomplete="email" class={inputCls} />
                                <button type="submit" class="w-full rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition mt-5">Send login link</button>
                            </form>
                        </>
                    )}

                    <a href="/" class="block text-center mt-6 text-xs font-medium text-ink-500 hover:text-brand-600 no-underline transition">← Back to homepage</a>
                </div>
            </body>
        </html>
    );
};
