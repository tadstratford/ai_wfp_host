/**
 * Knowledge Packs — Area 5
 *
 * .md files at three levels:
 * - System: shipped with app (knowledge/system/)
 * - Operations: AI job instructions (knowledge/operations/)
 * - User: created by/for the user (database)
 *
 * See docs/5-knowledge-packs.md for full specification.
 */

export { savePack, getPack, listPacks, deletePack, ensureKnowledgeTable, type KnowledgePack } from "./store";
export { loadUserPacks, loadUserPack } from "./loader";
export {
  PRIVACY_MAP_NAME,
  AUTO_MASK_NAME,
  LEGACY_AUTO_MASK_NAME,
  MAX_AUTO_MASK_TOTAL,
  loadPrivacyMap,
  loadPrivacyReverseMap,
  listPrivacyEntries,
  setPrivacyEntities,
  mergeAutoValues,
  clearAutoMask,
  type PrivacyEntry,
} from "./privacy";
export { parseFrontmatter, validatePack, type PackFrontmatter } from "./template";
export {
  parseSuccessFactors,
  hasSuccessFactors,
  summarizeSuccessFactors,
  SUCCESS_FACTORS_HEADING,
  type SuccessFactor,
  type SuccessFactorMode,
} from "./successFactors";
export {
  runSuccessFactorAudit,
  formatAuditMarkdown,
  type AuditReport,
  type AuditVerdict,
  type FactorAudit,
} from "./successFactorAudit";
export {
  listAuditVerdicts,
  extractVerdicts,
  findVerdictForJournal,
  type AuditVerdictSummary,
} from "./auditLog";
