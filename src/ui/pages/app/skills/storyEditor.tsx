import { Context } from "hono";
import type { User } from "@backend/types";
import type { StoryArchetype, Beat } from "wfp-format/story";
import { BEAT_TEMPLATES, BEAT_VERIFY_RULES } from "@core/stories/loader";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/**
 * Story editor — create/edit a workspace-authored story (a meta-plan of ordered
 * beats). Stories are stored under `.wfp stories[]` and layer over the
 * server-shipped stories (same id wins).
 *
 * The `beats` field is authored as a JSON array (advanced) so a story's beats,
 * their skills (by name), templates, and verification are fully explicit.
 */

const INPUT_CLS =
  "w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white";

export const makeStoryView = async (c: Context) => {
  const user = c.get("user") as User;
  if (!user.currentDatabaseId) {
    return c.html(<div class="p-6 text-coral-500">No workspace open.</div>);
  }
  const name = (c.req.query("id") || "").trim();
  const existing = name
    ? getSessionByDatabaseId(user.currentDatabaseId)?.getStory(name) ?? null
    : null;

  const example: Beat = {
    id: "setup",
    skills: ["data-account-check"],
    template: "map",
    verify: "accurate",
  };

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white mb-1">
        {existing ? `Edit story: ${existing.id}` : "New story"}
      </h1>
      <p class="text-sm text-ink-500 mb-5">
        A story is an ordered list of beats; each beat names the skills it uses.
        Workspace stories layer over the shipped stories.
      </p>

      <form hx-post="/app/make-story/save" hx-target="#main-panel" hx-swap="innerHTML" class="space-y-4">
        <input type="hidden" name="original_id" value={existing?.id ?? ""} />

        <div>
          <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Name (slug)</label>
          <input type="text" name="name" value={existing?.id ?? ""} placeholder="my-close-story" class={INPUT_CLS} />
        </div>

        <div>
          <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Description</label>
          <input type="text" name="description" value={existing?.description ?? ""} placeholder="What this story does" class={INPUT_CLS} />
        </div>

        <div>
          <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Classifier question (noul)</label>
          <textarea name="noul" rows={2} placeholder="Does this request ask to …?" class={INPUT_CLS}>
            {Object.values(existing?.nouls ?? {})[0] ?? ""}
          </textarea>
          <p class="text-xs text-ink-400 mt-1">Jev answers this to decide if this story applies.</p>
        </div>

        <div>
          <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Beats (JSON)</label>
          <textarea name="beats" rows={14} class={`${INPUT_CLS} font-mono`}>
            {JSON.stringify(existing?.beats ?? [example], null, 2)}
          </textarea>
          <p class="text-xs text-ink-400 mt-1">
            Each beat: <code>id</code>, <code>skills</code> (array of skill names),
            <code>template</code> ({BEAT_TEMPLATES.join(", ")}), <code>verify</code> ({BEAT_VERIFY_RULES.join(", ")}),
            optional <code>write</code>.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <button type="submit" class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition">
            Save story
          </button>
          <a
            hx-get="/app/stories"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl border border-ink/[0.1] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 no-underline"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>,
  );
};

export const saveStoryHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace open.</div>);

  const body = await c.req.parseBody();
  const originalId = (body.original_id as string || "").trim();
  const name = (body.name as string || "").trim().replace(/\s+/g, "-").toLowerCase();
  const description = (body.description as string || "").trim();
  const noul = (body.noul as string || "").trim();

  if (!name || !noul) {
    return c.html(<div class="p-6 text-coral-500">Name and classifier question are required.</div>);
  }

  let beats: Beat[];
  try {
    beats = JSON.parse(body.beats as string);
  } catch {
    return c.html(<div class="p-6 text-coral-500">Beats must be valid JSON.</div>);
  }
  if (!Array.isArray(beats) || beats.length === 0) {
    return c.html(<div class="p-6 text-coral-500">At least one beat is required.</div>);
  }

  for (const b of beats) {
    if (!b.id || !b.template || !b.verify) {
      return c.html(<div class="p-6 text-coral-500">Each beat needs id, template, and verify.</div>);
    }
    if (!BEAT_TEMPLATES.includes(b.template)) {
      return c.html(<div class="p-6 text-coral-500">Unknown template in beat "{b.id}".</div>);
    }
    if (!BEAT_VERIFY_RULES.includes(b.verify)) {
      return c.html(<div class="p-6 text-coral-500">Unknown verify in beat "{b.id}".</div>);
    }
    for (const skill of (b.skills ?? []) as string[]) {
      if (typeof skill !== "string" || !skill.trim()) {
        return c.html(<div class="p-6 text-coral-500">Each skill must be a non-empty name.</div>);
      }
    }
  }

  const story: StoryArchetype = {
    id: name,
    description,
    nouls: { [name]: noul },
    beats: beats.map((b) => ({
      id: b.id,
      ...(b.skills && b.skills.length ? { skills: b.skills.map((s: string) => s.trim()) } : {}),
      template: b.template,
      verify: b.verify,
      ...(b.write ? { write: true } : {}),
    })),
  };

  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return c.html(<div class="p-6 text-coral-500">No workspace session.</div>);
  if (originalId && originalId !== name) ws.deleteStory(originalId);
  ws.upsertStory(story);

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-8 text-center">
      <h2 class="text-lg font-bold text-ink dark:text-white">Story saved</h2>
      <p class="text-sm text-ink-500 mt-1">“{name}” is available to the assistant.</p>
      <a
        hx-get="/app/stories"
        hx-target="#main-panel"
        hx-swap="innerHTML"
        class="inline-block mt-4 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white no-underline"
      >
        Back to stories
      </a>
    </div>,
  );
};

export const deleteStoryHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const id = decodeURIComponent(c.req.param("id"));
  if (databaseId && id) {
    getSessionByDatabaseId(databaseId)?.deleteStory(id);
  }
  const { skillsView } = await import("./skillsPanel");
  return skillsView(c);
};
