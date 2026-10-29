/**
 * vers_11 config — the single server-global knob surface.
 *
 * Every tunable in the harness lives here. There is no per-workspace or
 * per-user setting: the operator sets these values once (here or via env) and
 * the orchestrator, planner, and resolver all read from `loadConfig()`.
 *
 * Env overrides mutate the config object at first load (cached thereafter);
 * unknown values fall back to the default. A value that is not a number or is
 * out of range falls back — never silently substituted into behavior.
 */

export type EngineChoice = "jev" | "llm";

export type EscalationCeiling =
  | "tool"            // deterministic tools only (no model)
  | "spec"            // LLM may emit a RuleSpec; code computes
  | "judgment"        // + Jev check_data judgments
  | "llm-specify"     // + LLM fills tool args (default)
  | "llm-generate";   // + LLM may generate data (always verify-gated)

export interface Vers11Config {
  /** Model variability + budget per call. */
  llm: { temperature: number; maxTokens: number };

  /** Which engine runs each decision stage (the LLM⇄Jev mix). */
  engine: {
    routing: EngineChoice;
    planShape: EngineChoice;
    ruleSelect: EngineChoice;
    ruleClassify: EngineChoice;
    verify: EngineChoice;
  };

  /** The compute-ladder posture. */
  escalation: {
    ceiling: EscalationCeiling;
    gapDefault: "clarify" | "auto-specify" | "fenced-llm";
    arithmeticBan: "hard" | "soft";
  };

  /** Routing thresholds. */
  routing: { skillProbThreshold: number; maxSkills: number };

  /** Rule-selection funnel thresholds. */
  rules: {
    tagThreshold: number;
    probThreshold: number;
    maxRules: number;
    maxTags: number;
    maxCandidates: number;
  };

  /** Loop bounds. */
  loop: {
    maxSteps: number;
    maxReplans: number;
    toolTimeoutMs: number;
    maxResolveCalls: number;
  };

  /** Per-turn cost brake on LLM bridging. */
  budget: { maxLlmCallsPerTurn: number; maxLlmTokensPerTurn: number };

  /** Result verification + provenance. */
  verify: {
    enabled: boolean;
    gates: { satisfies: number; complete: number; accurate: number; thorough: number };
  };
  provenance: { labelLlmComputed: boolean };

  /** Session context cleaning bounds. */
  context: { maxHistory: number; maxEvidence: number; maxToolCalls: number };
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function int(key: string, fallback: number): number {
  return Math.round(num(key, fallback));
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true";
}

let cached: Vers11Config | null = null;

export function loadConfig(): Vers11Config {
  if (cached) return cached;

  cached = {
    llm: {
      temperature: num("LLM_TEMPERATURE", 0),
      maxTokens: int("LLM_MAX_TOKENS", 2000),
    },
    engine: {
      routing: (process.env.ENGINE_ROUTING as EngineChoice) ?? "jev",
      planShape: (process.env.ENGINE_PLAN_SHAPE as EngineChoice) ?? "jev",
      ruleSelect: (process.env.ENGINE_RULE_SELECT as EngineChoice) ?? "jev",
      ruleClassify: (process.env.ENGINE_RULE_CLASSIFY as EngineChoice) ?? "jev",
      verify: (process.env.ENGINE_VERIFY as EngineChoice) ?? "llm",
    },
    escalation: {
      ceiling: (process.env.ESCALATION_CEILING as EscalationCeiling) ?? "llm-specify",
      gapDefault: (process.env.ESCALATION_GAP_DEFAULT ?? "clarify") as Vers11Config["escalation"]["gapDefault"],
      arithmeticBan: (process.env.ESCALATION_ARITHMETIC_BAN ?? "hard") as "hard" | "soft",
    },
    routing: {
      skillProbThreshold: num("SKILL_PROB_THRESHOLD", 0.15),
      maxSkills: Math.max(1, int("MAX_SKILLS", 3)),
    },
    rules: {
      tagThreshold: num("RULE_TAG_THRESHOLD", 0.3),
      probThreshold: num("RULE_PROB_THRESHOLD", 0.15),
      maxRules: Math.max(1, int("RULE_MAX_RULES", 8)),
      maxTags: Math.max(1, int("RULE_MAX_TAGS", 50)),
      maxCandidates: Math.max(1, int("RULE_MAX_CANDIDATES", 40)),
    },
    loop: {
      maxSteps: int("MAX_STEPS", 12),
      maxReplans: int("MAX_REPLANS", 1),
      toolTimeoutMs: int("TOOL_TIMEOUT_MS", 120_000),
      maxResolveCalls: int("MAX_RESOLVE_CALLS", 8),
    },
    budget: {
      maxLlmCallsPerTurn: int("MAX_LLM_CALLS_PER_TURN", 10),
      maxLlmTokensPerTurn: int("MAX_LLM_TOKENS_PER_TURN", 60_000),
    },
    verify: {
      enabled: bool("VERIFY_ENABLED", true),
      gates: {
        satisfies: num("VERIFY_SATISFIES", 0.6),
        complete: num("VERIFY_COMPLETE", 0.6),
        accurate: num("VERIFY_ACCURATE", 0.6),
        thorough: num("VERIFY_THOROUGH", 0.6),
      },
    },
    provenance: { labelLlmComputed: bool("LABEL_LLM_COMPUTED", true) },
    context: {
      maxHistory: int("CTX_MAX_HISTORY", 20),
      maxEvidence: int("CTX_MAX_EVIDENCE", 10),
      maxToolCalls: int("CTX_MAX_TOOL_CALLS", 40),
    },
  };

  return cached;
}
