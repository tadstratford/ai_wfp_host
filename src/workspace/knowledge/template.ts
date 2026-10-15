/**
 * Knowledge Pack Template — Area 5
 *
 * Parse frontmatter from .md files and validate pack structure.
 */

export interface PackFrontmatter {
  name: string;
  type?: "system" | "operations" | "user";
  scope?: "chat" | "workflow" | "chat+workflow";
  tags?: string[];
}

/**
 * Parse YAML-like frontmatter from a markdown string.
 * Expects format:
 * ---
 * name: Tax Rules
 * scope: chat+workflow
 * tags: [tax, classification]
 * ---
 * (content)
 */
export function parseFrontmatter(content: string): {
  frontmatter: PackFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    // No frontmatter — treat entire content as body
    return {
      frontmatter: { name: "" },
      body: content,
    };
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  const frontmatter: PackFrontmatter = { name: "" };

  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    switch (key) {
      case "name":
        frontmatter.name = value.trim();
        break;
      case "type":
        frontmatter.type = value.trim() as PackFrontmatter["type"];
        break;
      case "scope":
        frontmatter.scope = value.trim() as PackFrontmatter["scope"];
        break;
      case "tags":
        // Parse [tag1, tag2] or tag1, tag2
        frontmatter.tags = value
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        break;
    }
  }

  return { frontmatter, body };
}

/**
 * Validate a pack has the minimum required fields.
 */
export function validatePack(pack: {
  name?: string;
  content?: string | string[];
}): { valid: boolean; error?: string } {
  if (!pack.name || pack.name.trim().length === 0) {
    return { valid: false, error: "Knowledge pack must have a name" };
  }
  const content = pack.content;
  const empty =
    typeof content === "string"
      ? content.trim().length === 0
      : !Array.isArray(content) || content.length === 0;
  if (empty) {
    return { valid: false, error: "Knowledge pack must have content" };
  }
  return { valid: true };
}
