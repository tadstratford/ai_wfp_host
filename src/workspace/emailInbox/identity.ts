// emailInbox/identity — the shadow identity convention used by the headless
// email agent, and a helper to map a shadow id back to its real owner.
//
// Inbound email is processed under a synthetic `<real>::email-agent` identity so
// the owner's interactive session is never touched. Some infrastructure (LLM
// config, admin_users lookups) must resolve the REAL owner, so those paths call
// `realId()` to strip the suffix. Real ids never contain `::`.

export const SHADOW_SUFFIX = "::email-agent";

export function realId(id: string): string {
  const i = id.indexOf("::");
  return i === -1 ? id : id.slice(0, i);
}
