/**
 * Model-routing seam — maps a logical request to the cheapest provider/model
 * that meets a quality bar ("best-performing models per dollar").
 *
 * STUB: returns the configured default. The cost/quality mapping behind the
 * public metered proxy is implemented later (see ARCHITECTURE-DECISIONS.md §8).
 */

export interface RouteRequest {
  purpose?: "classifier" | "llm";
}

export interface RouteResult {
  provider: string;
  model?: string;
}

export function routeModel(request: RouteRequest): RouteResult {
  if (request.purpose === "classifier") {
    return { provider: process.env.CLASSIFIER_PROVIDER || "openrouter" };
  }
  return { provider: process.env.LLM_API_PROVIDER || "openrouter" };
}
