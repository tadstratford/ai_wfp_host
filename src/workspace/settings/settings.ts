// settings.ts - Functional configuration utility
import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { encrypt, decrypt } from "../../shared/crypto";
import { dataRoot } from "../../shared/dataRoot";

interface AppSettings {
  database: {
    name: string;
    path?: string;
  };
  llm: {
    provider: string;
    model: string;
    visionModel: string;

    apiKeyEnv: string;
    encryptedApiKey?: string;
    temperature?: number;
    maxTokens?: number;
  };
  darkMode?: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  database: {
    name: "Sample.db",
    path: undefined,
  },
  llm: {
    provider: "together",
    model: process.env.TOGETHER_MODEL || "deepseek-ai/DeepSeek-V3",
    visionModel:
      process.env.TOGETHER_VISION_MODEL ||
      "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
    temperature: 0.7,
    maxTokens: 2048,
  },
  darkMode: false,
};

const INSTANCE = process.env.INSTANCE || "local";

// Strictly use data/{INSTANCE}
const DB_ROOT = join(dataRoot(), "data", INSTANCE);

// Cache for settings per user
const settingsCache = new Map<string, AppSettings>();

const getSettingsPath = (userId: string = "default") => {
  // If userId is absolute path or weird, sanitize?
  // Assuming userId is clean from ConnectionManager checks.
  // If userId is 'default', we might store it in root or in db/default/settings.json?
  // User requested: "settings.json should be in each users directory".
  const userDir = join(DB_ROOT, userId);
  if (!existsSync(userDir)) {
    try { mkdirSync(userDir, { recursive: true }); } catch (e) { }
  }
  return join(userDir, "settings.json");
};

// Load settings from disk
const loadSettings = (userId: string = "default"): AppSettings => {
  if (settingsCache.has(userId)) {
    return settingsCache.get(userId)!;
  }

  const path = getSettingsPath(userId);

  try {
    if (existsSync(path)) {
      const data = readFileSync(path, "utf-8");
      const parsed = JSON.parse(data) as Partial<AppSettings>;
      const merged = deepMerge(DEFAULT_SETTINGS, parsed);
      settingsCache.set(userId, merged);
      return merged;
    }
  } catch (error) {
    console.warn(`Failed to load settings for ${userId}, using defaults:`, error);
  }

  // If new user, save defaults
  saveSettings(userId, DEFAULT_SETTINGS);
  settingsCache.set(userId, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
};

// Save settings to disk
const saveSettings = (userId: string, settings: AppSettings): void => {
  const path = getSettingsPath(userId);
  try {
    writeFileSync(path, JSON.stringify(settings, null, 2));
    settingsCache.set(userId, settings);
  } catch (error) {
    console.error(`Failed to save settings for ${userId}:`, error);
  }
};

// Deep merge utility
const deepMerge = <T>(defaults: T, overrides: Partial<T>): T => {
  const result = { ...defaults };

  for (const key in overrides) {
    if (overrides[key] !== undefined) {
      if (
        typeof defaults[key] === "object" &&
        !Array.isArray(defaults[key]) &&
        defaults[key] !== null
      ) {
        result[key] = deepMerge(defaults[key], overrides[key] as any);
      } else {
        result[key] = overrides[key] as any;
      }
    }
  }

  return result;
};

// Public Accessors
export const getUserSettings = (userId: string) => loadSettings(userId);

export const updateUserSettings = (userId: string, updates: Partial<AppSettings>) => {
  const current = loadSettings(userId);
  const updated = deepMerge(current, updates);
  saveSettings(userId, updated);
};

// Legacy Singletons (Default User)
// We treat "default" user as the system default.
export const getSettings = (): AppSettings => loadSettings("default");
export const updateSettings = (updates: Partial<AppSettings>): void => updateUserSettings("default", updates);

export const getDatabasePath = (userId: string = "default"): string => {
  const s = loadSettings(userId);
  const dbDir = join(DB_ROOT, userId);
  return join(dbDir, s.database.name);
};

// Convenience getters (default user)
export const getDatabase = () => ({ ...getSettings().database });
export const getLLMConfig = () => ({ ...getSettings().llm });

export const setDatabaseName = (name: string) =>
  updateSettings({ database: { ...getSettings().database, name } });

export const setDatabasePath = (path: string) =>
  updateSettings({ database: { ...getSettings().database, path } });

export const updateLLMConfig = (llmUpdates: Partial<AppSettings["llm"]>) =>
  updateSettings({ llm: { ...getSettings().llm, ...llmUpdates } });

// Main Export
export const settings = {
  get databaseName() {
    return getSettings().database.name;
  },
  get databasePath() {
    return getDatabasePath(); // "default"
  },
  get llmProvider() {
    return getSettings().llm.provider;
  },
  get llmModel() {
    return getSettings().llm.model;
  },
  get llmVisionModel() {
    return getSettings().llm.visionModel;
  },
  get llmApiKeyEnv() {
    return getSettings().llm.apiKeyEnv;
  },

  // Encrypted Key Management
  setLLMApiKey: (userId: string, key: string) => {
    updateUserSettings(userId, { llm: { ...getUserSettings(userId).llm, encryptedApiKey: encrypt(key) } });
  },
  getLLMApiKey: (userId: string) => {
    const s = getUserSettings(userId);
    if (s.llm && s.llm.encryptedApiKey) {
      return decrypt(s.llm.encryptedApiKey);
    }
    return undefined;
  },

  setDatabaseName,
  setDatabasePath,
  setLLMProvider: (provider: string) => updateLLMConfig({ provider }),
  setLLMModel: (model: string) => updateLLMConfig({ model }),
  setLLMVisionModel: (model: string) => updateLLMConfig({ visionModel: model }),
  get darkMode() {
    return getSettings().darkMode ?? false;
  },
  setDarkMode: (enabled: boolean) => updateSettings({ darkMode: enabled }),

  // New multi-user methods
  getUserSettings,
  updateUserSettings,

  getAllSettings: getSettings,
  updateSettings,
  getLLMConfig,
  updateLLMConfig,
};
