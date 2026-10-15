// Point-of-use PII masking for LLM calls.
//
// The map passed in is a forward map (real value → masked stand-in). Realistic
// stand-ins (e.g. "John Smith" → "Cliff Jones") keep the data semantically
// meaningful for the model, unlike the old opaque `<eN>` tokens. `maskCallOptions`
// applies the map to the outgoing request; `unmaskResult` reverses it on the
// response.

import { isOrgSuffix } from "@backend/core/knowledge/fakeGen";

export interface MaskedCallOptions {
  opts: any;
  substitutionCount: number;
}

export function maskCallOptions(
  opts: any,
  privacyMap: Map<string, string>,
): MaskedCallOptions {
  let substitutionCount = 0;
  const masked = { ...opts };

  // Longest-first so longer entities are replaced before shorter substrings.
  const entries = Array.from(privacyMap.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [entity, replacement] of entries) {
    const escaped = escapeRegExp(entity);

    if (typeof masked.system === "string") {
      const before = masked.system;
      masked.system = masked.system.replaceAll(escaped, replacement);
      substitutionCount += countReplacements(before, masked.system, entity);
    }

    if (Array.isArray(masked.messages)) {
      masked.messages = masked.messages.map((msg: any) => {
        if (typeof msg.content === "string") {
          const before = msg.content;
          const after = msg.content.replaceAll(escaped, replacement);
          substitutionCount += countReplacements(before, after, entity);
          return { ...msg, content: after };
        }
        if (Array.isArray(msg.content)) {
          const blocks = msg.content.map((block: any) => {
            if (block.type === "text" && typeof block.text === "string") {
              const before = block.text;
              const after = block.text.replaceAll(escaped, replacement);
              substitutionCount += countReplacements(before, after, entity);
              return { ...block, text: after };
            }
            if (block.type === "tool_result" && typeof block.content === "string") {
              const before = block.content;
              const after = block.content.replaceAll(escaped, replacement);
              substitutionCount += countReplacements(before, after, entity);
              return { ...block, content: after };
            }
            return block;
          });
          return { ...msg, content: blocks };
        }
        return msg;
      });
    }
  }

  return { opts: masked, substitutionCount };
}

export function unmaskResult(
  result: any,
  privacyMap: Map<string, string>,
): any {
  const unmasked = { ...result };

  const entries = buildReverseEntries(privacyMap);

  for (const [replacement, entity] of entries) {
    if (typeof unmasked.text === "string") {
      unmasked.text = unmasked.text.replaceAll(replacement, entity);
    }

    if (unmasked.toolCall) {
      if (typeof unmasked.toolCall.name === "string") {
        unmasked.toolCall.name = unmasked.toolCall.name.replaceAll(replacement, entity);
      }
      if (unmasked.toolCall.args && typeof unmasked.toolCall.args === "object") {
        unmasked.toolCall.args = deepUnmask(unmasked.toolCall.args, entries);
      }
    }
  }

  return unmasked;
}

/**
 * Build the reverse (stand-in → real) substitution list, longest stand-in
 * first so longer entities are restored before shorter substrings. For org
 * names that share a trailing legal suffix, also map the suffix-stripped
 * stand-in back to the real value — the model often drops the suffix
 * ("Pioneer West LP" → "Pioneer West"), which would otherwise leak through.
 */
function buildReverseEntries(privacyMap: Map<string, string>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [entity, replacement] of privacyMap) {
    entries.push([replacement, entity]);

    const realTokens = entity.trim().split(/\s+/).filter(Boolean);
    const fakeTokens = replacement.trim().split(/\s+/).filter(Boolean);
    if (realTokens.length > 1 && fakeTokens.length > 1) {
      const realSuffix = realTokens[realTokens.length - 1];
      const fakeSuffix = fakeTokens[fakeTokens.length - 1];
      if (
        realSuffix.toLowerCase() === fakeSuffix.toLowerCase() &&
        isOrgSuffix(fakeSuffix)
      ) {
        const stripped = fakeTokens.slice(0, -1).join(" ");
        if (stripped) entries.push([stripped, entity]);
      }
    }
  }
  return entries.sort((a, b) => b[0].length - a[0].length);
}

export async function writePrivacyLog(
  source: string,
  substitutionCount: number,
  entityCount: number,
  _callOpts: any,
): Promise<void> {
  console.log(
    `[privacyMask] ${source}: ${substitutionCount} substitution(s) across ${entityCount} entity(ies)`,
  );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countReplacements(
  before: string,
  after: string,
  entity: string,
): number {
  if (before === after) return 0;
  const escaped = escapeRegExp(entity);
  const regex = new RegExp(escaped, "g");
  const matches = before.match(regex);
  return matches ? matches.length : 0;
}

function deepUnmask(
  obj: Record<string, unknown>,
  entries: Array<[string, string]>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = replaceAllEntries(value, entries);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = deepUnmask(value as Record<string, unknown>, entries);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? replaceAllEntries(item, entries)
          : typeof item === "object" && item !== null
            ? deepUnmask(item as Record<string, unknown>, entries)
            : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function replaceAllEntries(text: string, entries: Array<[string, string]>): string {
  let out = text;
  for (const [replacement, entity] of entries) {
    out = out.replaceAll(replacement, entity);
  }
  return out;
}
