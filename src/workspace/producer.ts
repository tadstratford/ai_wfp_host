// Producer identity — the "who/what wrote this" stamp on provenance events.
//
// A capability, workflow, or agent sets the context before it mutates the
// workspace so the ledger can truthfully record "budget app 2.3" vs
// "accounting agent 3". Falls back to the host app. Process-local (like the
// session itself); a single default is fine because provenance events are
// stamped per-mutation under whatever producer is active at that moment.

export interface ProducerContext {
  producer: string;
  producerVersion: string;
}

const DEFAULT: ProducerContext = {
  producer: "workflowpeople",
  producerVersion: "1.0.0",
};

let current: ProducerContext = { ...DEFAULT };

/** Override the active producer (e.g. around a workflow run). */
export function setProducerContext(ctx: Partial<ProducerContext>): void {
  current = { ...current, ...ctx };
}

/** Reset to the host default (e.g. at the end of a run). */
export function resetProducerContext(): void {
  current = { ...DEFAULT };
}

export function getProducerContext(): ProducerContext {
  return current;
}
