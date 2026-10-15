// Knowledge pack helpers.
//
// `getKnowledge(name)` is part of Tier 1+2; the work is a lookup against
// `file.knowledge[]`.

import type { WfpFile } from "wfp-format";

export function getKnowledgePack(file: WfpFile, name: string): string | null {
  const pack = file.knowledge?.find((p) => p.name === name);
  return pack && typeof pack.content === "string" ? pack.content : null;
}
