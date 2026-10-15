import { readFileSync, statSync } from "fs";
import { join } from "path";

const PROMPTS_DIR = join(__dirname);
const CONCEPTS_DIR = join(__dirname, "..", "vers_5", "knowledge");

// Cache prompt/concept file contents keyed by path, invalidated by mtime, so the
// build pipeline (which re-loads concept packs for every plan) doesn't re-read
// large files from disk repeatedly.
const fileCache = new Map<string, { mtimeMs: number; content: string }>();

function readFileCached(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.content;
    }
    const content = readFileSync(filePath, "utf-8");
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}

export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const filePath = join(PROMPTS_DIR, `${name}.md`);

  const raw = readFileCached(filePath);
  if (raw === null) {
    throw new Error(`[loadPrompt] Prompt file not found: ${filePath}`);
  }

  let content = raw;
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value ?? "");
  }

  return content;
}

/**
 * Load and concatenate multiple expert prompts in order.
 * Used to assemble the full system prompt from base + relevant experts.
 */
export function assemblePrompt(
  parts: string[],
  vars: Record<string, string> = {}
): string {
  return parts
    .map((name) => loadPrompt(name, vars))
    .join("\n\n---\n\n");
}

/**
 * Load one or more concept modules and return as a merged vars object.
 * Concept files live in chat/vers_5/knowledge/*.md. Each concept is keyed
 * by its uppercase filename (e.g. "typed-envelope" → "TYPED_ENVELOPE").
 *
 * Missing concept files are silently skipped (empty string).
 *
 * Usage:
 *   const concepts = loadConcepts(["typed-envelope", "api-reference"]);
 *   const prompt = loadPrompt("pipeline/planner", concepts);
 */
export function loadOperationsPack(_name: string): string | null {
  return null;
}

export function loadConcepts(names: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of names) {
    const key = name.toUpperCase().replace(/-/g, "_");
    const filePath = join(CONCEPTS_DIR, `${name}.md`);
    vars[key] = readFileCached(filePath) ?? "";
  }
  return vars;
}
