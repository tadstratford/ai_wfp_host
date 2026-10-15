import { runBuildPipeline } from "./build-pipeline";
import type { BuildPipelineParams } from "./build-pipeline-types";

/**
 * Background workflow build runner.
 *
 * The Make Workflow wizard kicks a build off in the background so the browser
 * can immediately show a progress view (spinner + live status + steps) instead
 * of hanging on a synchronous request. The result (or error) is stored here,
 * keyed by buildId, and the wizard's polling view reads it via getBuild().
 */

export interface BuildState {
  status: "running" | "done" | "error";
  /** The approved BuildPlan — retained so the progress view can re-render the steps. */
  plan?: unknown;
  /** runBuildPipeline Stage 2-4 result (text, log, workflowId). */
  result?: any;
  error?: string;
}

const builds = new Map<string, BuildState>();

export function startBuild(buildId: string, params: BuildPipelineParams, plan: unknown): void {
  builds.set(buildId, { status: "running", plan });
  runBuildPipeline(params)
    .then((result) => {
      builds.set(buildId, { status: "done", plan, result });
    })
    .catch((err) => {
      builds.set(buildId, { status: "error", plan, error: err.message || String(err) });
    });
}

export function getBuild(buildId: string): BuildState | undefined {
  return builds.get(buildId);
}
