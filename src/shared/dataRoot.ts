/**
 * dataRoot — the base directory for every file the app writes to disk.
 *
 * Resolution order:
 *   1. `DATA_DIR` env — explicit override (hosted/cloud deployments point this
 *      at a known writable path).
 *   2. `process.cwd()` — the `hosted` edition (matches the historical behavior).
 *   3. Per-user OS-standard location — `enterprise`/`local`, so the standalone
 *      single-binary lands files somewhere predictable instead of wherever the
 *      process happened to start.
 *
 * Consumers keep their existing sub-structure (`data/<instance>/…`, `logs/…`);
 * this helper only replaces the `process.cwd()` root.
 */

import { join } from "path";
import { homedir } from "os";
import { dataRootIsCwd } from "./edition";

export function dataRoot(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (dataRootIsCwd()) return process.cwd();

  const home = homedir();

  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "WorkflowPeople");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "WorkflowPeople");
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "workflowpeople");
}
