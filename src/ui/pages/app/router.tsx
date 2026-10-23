import { Hono, type Handler } from "hono";
import { appPage } from "./page";
import { workflowViewPanel } from "./workflows/workflowView";
import { workflowRunPanel } from "./workflows/workflowRun";
import { workflowEditView } from "./workflows/specEditor";

import { overviewGlassBoxView, overviewGenUiView } from "./overview/overviewGlassBox";
import { rulesPanelView, rulesDetailView, rulesSaveHandler, rulesDeleteHandler } from "./rules/rulesPanel";
import { makeRuleView, startRuleInterview, ruleInterviewStep, finalizeRuleInterview, saveRuleHandler } from "./rules/ruleWizard";
import { privacyPanelView, privacySaveHandler, privacyAutomateHandler, privacyAutomateClearHandler } from "./privacy/privacyPanel";
import { timeMachineView, timeMachineDiffView, timeMachineCheckpointView, timeMachineSnapshotHandler, timeMachineDownloadView } from "./timemachine/timemachinePanel";
import { logDetailView } from "./logs/logDetail";
import { logCompareView } from "./logs/logCompare";
import { clearDataHandler } from "./data/clearData";
import { dataPanelView, dataFileListHandler, dataPasteHandler, dataEditModalHandler } from "./data/dataPanel";

import {
  workspacePageView,
  workflowModalView,
  workspaceChatModalView,
  workspaceChatHandler,
  resetWorkflowHandler,
  resetAllWorkflowsHandler,
  setWorkflowGroupHandler,
  copyWorkflowHandler,
} from "./workflows/workspacePanel";
import {
  workflowGroupResetHandler,
  workflowReorderHandler,
} from "./workflows/workflowGroupHandlers";
import { newWorkflowPlanHandler, newWorkflowBuildHandler } from "./workflows/planBuild";
import {
  makeWorkflowView,
  startInterview,
  interviewStep,
  finalizeInterview,
  makeWorkflowBuildHandler,
  makeWorkflowResultHandler,
} from "./workflows/wizardPage";
import {
  modifyWizardView,
  modifyStartHandler,
  modifyInterviewStep,
  finalizeModifyInterview,
  modifyApplyHandler,
} from "./workflows/modifyWizard";
import {
  workspaceShareModalView,
  inviteHandler,
  revokeHandler,
  openSharedWorkspaceHandler,
} from "./sharePanel";
import { workflowHistoryHandler } from "./workflows/historyPanel";
import {
  copyFromFileUploadHandler,
  copyFromFileDecryptHandler,
  copyFromFileImportWorkflowHandler,
  copyFromFileImportRuleHandler,
  copyFromFileImportDataHandler,
} from "./workflows/copyFromFile";
import { deleteWorkflowHandler, deleteSessionHandler, clearSessionsHandler, clearAllSessionsHandler } from "./deleteHandlers";
import { setCurrentChatMode } from "@server/user/databaseAccess";
import type { User } from "@backend/types";
import { sessionViewHandler } from "./sessionView";

import {
  workspacesStandaloneView,
  newWorkspaceModal,
  newWorkspaceSubmit,
  openWorkspaceModal,
  openWorkspaceSubmit,
  deleteWorkspaceModal,
  deleteWorkspaceSubmit,
  diskUploadHandler,
  diskDecryptHandler,
  saveActiveHandler,
  saveAsModal,
  saveAsSubmit,
  closeActiveHandler,
  newBlankHandler,
  saveToAccountHandler,
  openOwnedDirectHandler,
  settingsModalView,
  settingsSubmit,
  modifyWorkspaceHandler,
  workspaceDetailsModal,
  workspaceDetailsSubmit,
  workspaceEmailRotate,
} from "./workspacesPage";
import {
  workspaceInboundModal,
  workspaceInboundAdd,
  workspaceInboundRemove,
  workspaceOutboundModal,
  workspaceOutboundAdd,
  workspaceOutboundRemove,
} from "./workspaceAccess";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { workspaceApiRouter } from "./workspace/api/router";
import { modelListHandler } from "@server/api/modelList";
import { modelPrefsGetHandler, modelPrefsPostHandler } from "@server/api/modelPrefs";
import { modelInfoHandler, modelInfoRailHandler } from "@server/api/modelInfo";
import { modelPickerHandler } from "@server/api/modelPicker";
import { keyFormHandler } from "@server/api/keyForm";
import { creditStatusHandler, redeemCodeHandler } from "@server/api/betaCredit";
import { usagePanelHandler } from "@server/api/usage";
import { capabilitiesPrefsCardHandler, capabilitiesPrefsSaveHandler } from "@server/api/capabilitiesPrefs";
import { navPrefsCardHandler, navPrefsSaveHandler } from "@server/api/navPrefs";
import { qboStatusHandler, qboDisconnectHandler } from "@server/api/qboStatus";
import type { User as UserCtx } from "@backend/types";
import { handleSimpleSSE } from "@backend/interfaces/streaming/simpleSSE";
import {
  shellPage,
  workspaceShellLanding,
  workspaceShellChat,
  pushUrl,
} from "./workspace/shellPage";
import { userScreenView } from "@frontend/pages/user/page";
import { accountStandaloneView } from "@frontend/pages/account/page";
import { workspaceDownloadModalHandler } from "./workspace/downloadModal";

export const appRouter = new Hono();

// ── Picker + workspace lifecycle (ungated — reachable without a session) ─────
// /app/workspaces is the simple "My workspaces" picker (single edition).
appRouter.get("/workspaces", workspacesStandaloneView);
appRouter.get("/workspaces/modal/new", newWorkspaceModal);
appRouter.post("/workspaces/new", newWorkspaceSubmit);
appRouter.post("/workspaces/new-blank", newBlankHandler);
appRouter.post("/workspaces/save-to-account", saveToAccountHandler);
appRouter.get("/workspaces/:id/modal/open", openWorkspaceModal);
appRouter.post("/workspaces/:id/open", openWorkspaceSubmit);
appRouter.get("/workspaces/:id/open", openOwnedDirectHandler);
appRouter.get("/workspaces/:id/settings", settingsModalView);
appRouter.post("/workspaces/:id/settings", settingsSubmit);
appRouter.get("/workspaces/:id/modify", modifyWorkspaceHandler);
appRouter.get("/workspaces/:id/modal/delete", deleteWorkspaceModal);
appRouter.delete("/workspaces/:id", deleteWorkspaceSubmit);
appRouter.get("/workspaces/:id/details", workspaceDetailsModal);
appRouter.post("/workspaces/:id/details", workspaceDetailsSubmit);
appRouter.get("/workspaces/:id/access/inbound", workspaceInboundModal);
appRouter.post("/workspaces/:id/access/inbound", workspaceInboundAdd);
appRouter.delete("/workspaces/:id/access/inbound", workspaceInboundRemove);
appRouter.get("/workspaces/:id/access/outbound", workspaceOutboundModal);
appRouter.post("/workspaces/:id/access/outbound", workspaceOutboundAdd);
appRouter.delete("/workspaces/:id/access/outbound", workspaceOutboundRemove);
appRouter.post("/workspaces/:id/email/rotate", workspaceEmailRotate);
appRouter.post("/workspaces/disk/upload", diskUploadHandler);
appRouter.post("/workspaces/disk/decrypt", diskDecryptHandler);
appRouter.post("/workspaces/save", saveActiveHandler);
appRouter.get("/workspaces/modal/save-as", saveAsModal);
appRouter.post("/workspaces/save-as", saveAsSubmit);
appRouter.post("/workspaces/close", closeActiveHandler);

  // Sharing (per-workspace; managed from the picker's Sharing section).
  appRouter.get("/shared-workspace/:workspaceId/open", openSharedWorkspaceHandler);
  appRouter.get("/workspaces/:id/share", workspaceShareModalView);
  appRouter.post("/workspaces/:id/share/invite", inviteHandler);
  appRouter.delete("/workspaces/:id/share/:grantId", revokeHandler);

// Front door — redirects to the shell (workspace open) or the picker.
appRouter.get("/", appPage);

// Account — standalone usage/credit screen (no open workspace required).
appRouter.get("/account", accountStandaloneView);
// Account partials — also ungated so the standalone page can self-populate.
appRouter.get("/api/credit-status", creditStatusHandler);
appRouter.post("/api/redeem-code", redeemCodeHandler);
appRouter.get("/api/usage-panel", usagePanelHandler);

// ── Gate the rest of /app behind an active WorkspaceSession ──────────────────
appRouter.use("*", async (c, next) => {
  const user = c.get("user") as UserCtx | undefined;
  if (user) {
    const session = getWorkspaceSession(user.userId);
    if (!session) {
      if (c.req.header("HX-Request") === "true") {
        c.header("HX-Redirect", "/app");
        return c.text("No workspace open", 401);
      }
      return c.redirect("/app");
    }
    // Navigating/reading is activity — keep the session off the idle sweeper.
    session.markActive();
  }
  await next();
});

// ── Workspace API — data CRUD, export/import (session-gated) ─────────────────
appRouter.route("/workspace/api", workspaceApiRouter);

// ── Shell section pages (render full shell on direct nav, partial on HTMX) ──
appRouter.get("/overview", shellPage("overview", workspacePageView));
appRouter.get("/chat", workspaceShellChat);
appRouter.get("/data", shellPage("data", dataPanelView));
appRouter.get("/timemachine", shellPage("timemachine", timeMachineView));
appRouter.get("/timemachine/diff/:eventId", timeMachineDiffView);
appRouter.get("/timemachine/checkpoint/:id", timeMachineCheckpointView);
appRouter.get("/timemachine/download/:id", timeMachineDownloadView);
appRouter.post("/timemachine/snapshot", timeMachineSnapshotHandler);
appRouter.get("/rules", shellPage("rules", rulesPanelView));
appRouter.get("/privacy", shellPage("privacy", privacyPanelView, (c) => pushUrl(c)));
appRouter.get("/user", shellPage("user", userScreenView));

// ── Make Workflow wizard (full page) ─────────────────────────────────────────
appRouter.get("/make-workflow", shellPage("make", makeWorkflowView));
appRouter.post("/make-workflow/start", startInterview);
appRouter.post("/make-workflow/interview", interviewStep);
appRouter.post("/make-workflow/interview/finalize", finalizeInterview);
appRouter.post("/make-workflow/build", makeWorkflowBuildHandler);
appRouter.get("/make-workflow/result/:buildId", makeWorkflowResultHandler);

// ── Make Rule wizard (full page) ────────────────────────────────────────────
appRouter.get("/make-rule", shellPage("rules", makeRuleView));
appRouter.post("/make-rule/start", startRuleInterview);
appRouter.post("/make-rule/interview", ruleInterviewStep);
appRouter.post("/make-rule/interview/finalize", finalizeRuleInterview);
appRouter.post("/make-rule/save", saveRuleHandler);

// ── Modify Workflow wizard (full page) ───────────────────────────────────────
appRouter.get("/modify-workflow/:workflowId", shellPage("overview", modifyWizardView));
appRouter.post("/modify-workflow/:workflowId/start", modifyStartHandler);
appRouter.post("/modify-workflow/interview", modifyInterviewStep);
appRouter.post("/modify-workflow/interview/finalize", finalizeModifyInterview);
appRouter.post("/modify-workflow/apply", modifyApplyHandler);

// ── SSE ──────────────────────────────────────────────────────────────────────
appRouter.get("/sse", handleSimpleSSE);

// ── Section partials (loaded into #main-panel by shell pages) ────────────────
appRouter.get("/overview-glassbox", overviewGlassBoxView);
appRouter.get("/overview-genui", overviewGenUiView);
appRouter.get("/session", sessionViewHandler);
appRouter.get("/workspace", workspacePageView); // Workflows board (partial)
appRouter.get("/view/:workflowId", workflowViewPanel);
appRouter.get("/run/:workflowId", workflowRunPanel);
appRouter.get("/history/:workflowId", workflowHistoryHandler);

// Workflow edit view — live workflow (left) + chat session (right).
appRouter.get("/workflow/:workflowId/edit", workflowEditView);

// LLM API log detail — standalone page opened from session chat links.
appRouter.get("/logs/:logId", logDetailView);
appRouter.get("/logs/:logId/masked", logCompareView);

// Rules.
appRouter.get("/rules", rulesPanelView);
appRouter.get("/rules/:name", rulesDetailView);
appRouter.post("/rules/save", rulesSaveHandler);
appRouter.delete("/rules/:name", rulesDeleteHandler);

// Privacy map.
appRouter.get("/privacy", privacyPanelView);
appRouter.post("/privacy/save", privacySaveHandler);
appRouter.post("/privacy/automate", privacyAutomateHandler);
appRouter.post("/privacy/automate-clear", privacyAutomateClearHandler);

// Data management.
appRouter.get("/data", dataPanelView);
appRouter.get("/data/list", dataFileListHandler);
appRouter.get("/data/edit/:name", dataEditModalHandler);
appRouter.post("/data/paste", dataPasteHandler);
appRouter.post("/clear-data", clearDataHandler);

// Workflow build/chat modals.
appRouter.get("/modal/new-workflow", workflowModalView);
appRouter.post("/new-workflow", newWorkflowPlanHandler);
appRouter.post("/new-workflow/build", newWorkflowBuildHandler);
appRouter.get("/modal/new-workspace", workspaceChatModalView);
appRouter.get("/modal/modify-workspace", workspaceChatModalView);
appRouter.get("/modal/download-workspace", workspaceDownloadModalHandler);
appRouter.post("/workspace-chat", workspaceChatHandler);

// Delete operations.
appRouter.delete("/workflow/:workflowId", deleteWorkflowHandler);
appRouter.delete("/session/:sessionId", deleteSessionHandler);
appRouter.delete("/sessions", clearAllSessionsHandler);
appRouter.delete("/sessions/:workflowId", clearSessionsHandler);

// Workflow status reset.
appRouter.post("/workspace/reset-workflow/:workflowId", resetWorkflowHandler);
appRouter.post("/workspace/reset-all", resetAllWorkflowsHandler);

// Workflow nav-group (editable "group" column on the workflows board).
appRouter.post("/workflow/:workflowId/group", setWorkflowGroupHandler);

// Group-level actions (Reset all in group, Move up/down within group).
appRouter.post("/workflow-group/reset", workflowGroupResetHandler);
appRouter.post("/workflow/:workflowId/reorder", workflowReorderHandler);

// Copy (duplicate) a workflow.
appRouter.post("/workflow/:workflowId/copy", copyWorkflowHandler);

// Copy an item (workflow / rule / data) in from another .wfp file
// (local edition buttons, ungated routes).
appRouter.post("/copy-from-file/upload", copyFromFileUploadHandler);
appRouter.post("/copy-from-file/decrypt", copyFromFileDecryptHandler);
appRouter.post("/copy-from-file/workflow/:id", copyFromFileImportWorkflowHandler);
appRouter.post("/copy-from-file/rule/:id", copyFromFileImportRuleHandler);
appRouter.post("/copy-from-file/data/:id", copyFromFileImportDataHandler);

// Chat mode toggle — persists to admin_users.current_chat_mode
appRouter.post("/api/chat-mode", async (c) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  const mode = (body.mode as string) || "build";
  if (mode !== "plan" && mode !== "build") {
    return c.json({ error: "Invalid mode" }, 400);
  }
  await setCurrentChatMode(user, mode);
  return c.json({ ok: true, mode });
});

// Model list — returns available models from llm-providers.json
appRouter.get("/api/models", modelListHandler);

// Model preferences — read/write user's LLM provider/model
appRouter.get("/api/model-prefs", modelPrefsGetHandler);
appRouter.post("/api/model-prefs", modelPrefsPostHandler);

// Model info — current model, provider, configured keys
appRouter.get("/api/model-info", modelInfoHandler);
appRouter.get("/api/model-info-rail", modelInfoRailHandler);

// Model picker modal — opened from the right panel
appRouter.get("/api/model-picker", modelPickerHandler);

// Key form — inline key entry inside the model picker modal
appRouter.get("/api/key-form", keyFormHandler);

// Skills preference — enable/disable skill groups from the /app/user screen
appRouter.get("/api/capabilities-prefs", capabilitiesPrefsCardHandler);
appRouter.post("/api/capabilities-prefs", capabilitiesPrefsSaveHandler);

// Navigation preference — show/hide shell nav sections from the /app/user screen
appRouter.get("/api/nav-prefs", navPrefsCardHandler);
appRouter.post("/api/nav-prefs", navPrefsSaveHandler);

// QuickBooks connection — status card + disconnect from the /app/user screen
appRouter.get("/api/qbo-status", qboStatusHandler);
appRouter.post("/api/qbo-disconnect", qboDisconnectHandler);
