/**
 * Application Settings Module
 * 
 * File-based application configuration stored in settings.json.
 * For user preferences, see @backend/core/userSettings
 */
export {
  getSettings,
  updateSettings,
  getDatabasePath,
  getDatabase,
  getLLMConfig,
  setDatabaseName,
  setDatabasePath,
  updateLLMConfig,
  settings,
  getUserSettings,
  updateUserSettings,
} from "./settings";

export {
  SERVER_NAME,
  WORKSPACE_LABEL,
  WORKSPACE_LABEL_PLURAL,
} from "./instanceConfig";
