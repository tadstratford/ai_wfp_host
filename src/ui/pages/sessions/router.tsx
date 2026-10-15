import { Hono } from "hono";
import {
  startWorkflowChat,
  viewSessionChat,
  todoStartChat,
} from "./chatStream/index";
import { handleSimpleSSE } from "@backend/interfaces/streaming/simpleSSE";
import { messagesHandler, feedbackHandler } from "./chatStream/messagesHandler";
import { postMortemHandler } from "./chatStream/InlineAudit";
import { statusHandler } from "./chatStream/statusHandler";
import { buttonsHandler } from "./chatStream/buttonsHandler";
import { resumeHandler } from "./chatStream/resumeHandler";
import { resumePauseHandler } from "./chatStream/resumePauseHandler";
import { resumeStartHandler } from "./chatStream/resumeStartHandler";
import { sendHandler, buildSendHandler } from "./chatStream/sendHandler";
import { deleteSessionHandler } from "./sessionList/deleteSessionHandler";
import { exportHandler } from "./chatStream/exportHandler";
import { reportHandler } from "./reportHandler";
import { chatHistoryHandler } from "./chatStream/chatHistory";
import { savedPromptsHandler, savePromptHandler, deleteSavedPromptHandler } from "./chatStream/SavedPrompts";
import { dataRefsHandler } from "./chatStream/DataRefs";
import { saveAsWorkflowPlanHandler, saveAsWorkflowBuildHandler } from "./saveAsWorkflow";

export const sessionsRouter = new Hono();

// NB: these are partials loaded into the shell's #main-panel via /app/session
// (sessionViewHandler). The standalone /sessions page was retired.

// Start workflow (called via HTMX after page loads)
sessionsRouter.get("/start", startWorkflowChat);

// View existing session (called via HTMX)
sessionsRouter.get("/view", viewSessionChat);

// Start a todo task (auto-submit instruction)
sessionsRouter.get("/todo-start", todoStartChat);

// SSE endpoint - clients connect here for real-time notifications
sessionsRouter.get("/api/sse", handleSimpleSSE);

// API routes
sessionsRouter.get("/api/messages", messagesHandler);
sessionsRouter.get("/api/status", statusHandler);
sessionsRouter.get("/api/buttons", buttonsHandler);
sessionsRouter.post("/resume/:sessionId", resumeHandler);
sessionsRouter.post("/:sessionId/resume-pause", resumePauseHandler);
sessionsRouter.post("/api/resume-start/:sessionId", resumeStartHandler);
sessionsRouter.post("/send", sendHandler);
sessionsRouter.post("/api/build-send", buildSendHandler);
sessionsRouter.post("/api/feedback", feedbackHandler);

// Post-mortem analysis
sessionsRouter.post("/api/post-mortem", postMortemHandler);

// Chat history (previous sessions list)
sessionsRouter.get("/api/history", chatHistoryHandler);

// Saved prompts panel (right rail of the chat view)
sessionsRouter.get("/api/saved-prompts", savedPromptsHandler);
sessionsRouter.post("/api/save-prompt", savePromptHandler);
sessionsRouter.post("/api/delete-saved-prompt", deleteSavedPromptHandler);

// Data list panel (right rail of the chat view, under Saved prompts)
sessionsRouter.get("/api/data-refs", dataRefsHandler);

// Save chat session as a reusable workflow
sessionsRouter.post("/save-as-workflow", saveAsWorkflowPlanHandler);
sessionsRouter.post("/save-as-workflow/build", saveAsWorkflowBuildHandler);

// Delete session route
sessionsRouter.delete("/sessions/:id", deleteSessionHandler);
sessionsRouter.get("/export/:id", exportHandler);
sessionsRouter.get("/report", reportHandler);

// Form submission (interactive forms in chat sessions)
import { formSubmitHandler } from "./formHandler";
sessionsRouter.post("/form/submit", formSubmitHandler);

// Template interaction — HTMX actions in template-rendered messages
import { interactHandler, entityCsvHandler, entityReportHandler } from "./interactHandler";
sessionsRouter.post("/:sessionId/interact", interactHandler);
sessionsRouter.get("/:sessionId/entity-csv/:messageId", entityCsvHandler);
sessionsRouter.get("/:sessionId/entity-report/:messageId", entityReportHandler);

// Register templates (side-effect imports that call register())
import "@frontend/templates/account-table";
import "@frontend/templates/entity-manager";
import "@frontend/templates/data-table";




