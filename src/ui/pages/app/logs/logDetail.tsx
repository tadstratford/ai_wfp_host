import { Context } from "hono";
import type { User } from "@backend/types";
import { marked } from "marked";
import { formatLogMarkdown, getLog } from "@backend/core/workspace/logs";
import { SERVER_NAME } from "@backend/core/settings/instanceConfig";

export const logDetailView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Log — {SERVER_NAME}</title>
          <link rel="stylesheet" href="/public/css/tailwind.css" />
        </head>
        <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white p-8">
          <p class="text-coral-600">No workspace open.</p>
        </body>
      </html>,
    );
  }

  const logId = c.req.param("logId");
  // Logs are kept in memory for the current chat session only (not persisted),
  // so a lookup is just a memory read keyed by logId.
  let log: any = null;
  try {
    log = getLog(databaseId, logId);
  } catch (err) {
    console.error("[logDetail] Failed to load log:", err);
  }

  if (!log) {
    return c.html(
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Log Archived — {SERVER_NAME}</title>
          <link rel="stylesheet" href="/public/css/tailwind.css" />
        </head>
        <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white">
          <div class="max-w-2xl mx-auto px-4 py-16 md:px-8 text-center">
            <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white mb-3">Log Archived</h1>
            <p class="text-sm text-ink-500">
              This log entry is no longer available. LLM call logs are kept in memory for the current chat session only (not persisted), so starting a new session clears them.
            </p>
            <p class="text-xs text-ink-400 dark:text-ink-500 mt-2">
              Log ID: {logId}
            </p>
          </div>
        </body>
      </html>,
    );
  }

  const markdown = formatLogMarkdown(log);
  const html = marked.parse(markdown, { async: false }) as string;

  return c.html(
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>LLM API Log — {SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <style>{`
          body { font-family: 'Inter', system-ui, sans-serif; }
          pre { white-space: pre-wrap; word-wrap: break-word; }
          hr { border-color: #d1d5db; }
          .dark hr { border-color: #374151; }
        `}</style>
      </head>
      <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white">
        <div class="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-8">
          <div
            class="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </body>
    </html>,
  );
};
