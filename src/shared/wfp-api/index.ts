// wfp-api — entry point.
// See ./types.ts for the WFP_API interface and adapter shapes.

export * from "./types";
export { autoWrap, isEnvelope } from "./autoWrap";
export { wfpFetch } from "./fetch";
export { getKnowledgePack } from "./knowledge";
export { parseCsv, rowsToCsv, envelopeFromDataEntry } from "./csv";
