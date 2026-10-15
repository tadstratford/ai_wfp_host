import { join } from "path";
import { existsSync, mkdirSync } from "node:fs";
import { dataRoot } from "../shared/dataRoot";

// Ensure the workspace data directory exists (used by settings, .wfp store, etc.)
const INSTANCE_ID = process.env.INSTANCE || "local";
const INSTANCE_DIR = join(dataRoot(), "data", INSTANCE_ID);

if (!existsSync(INSTANCE_DIR)) {
  mkdirSync(INSTANCE_DIR, { recursive: true });
  console.log(`[Workspace] Created workspace directory: ${INSTANCE_DIR}`);
}
