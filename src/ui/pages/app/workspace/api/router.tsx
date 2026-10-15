import { Hono } from "hono";
import {
  workspaceExportHandler,
  workspaceExportEncryptedHandler,
  workspaceImportHandler,
  workspacePreviewHandler,
  workspaceNewHandler,
  userDataLoadHandler,
  userDataDeleteHandler,
  userDataDownloadHandler,
  userDataContentHandler,
  userDataUpdateHandler,
} from "./handlers";

export const workspaceApiRouter = new Hono();

// Workspace file export/import
workspaceApiRouter.get("/export", workspaceExportHandler);
workspaceApiRouter.post("/export", workspaceExportEncryptedHandler);
workspaceApiRouter.post("/import", workspaceImportHandler);
workspaceApiRouter.post("/import/preview", workspacePreviewHandler);

// New workspace (from saveWorkspace.js)
workspaceApiRouter.post("/new", workspaceNewHandler);

// Data CRUD
workspaceApiRouter.post("/data/load", userDataLoadHandler);
workspaceApiRouter.get("/data/:name/download", userDataDownloadHandler);
workspaceApiRouter.get("/data/:name/content", userDataContentHandler);
workspaceApiRouter.put("/data/:name", userDataUpdateHandler);
workspaceApiRouter.delete("/data/:name", userDataDeleteHandler);
