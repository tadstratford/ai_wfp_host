// UI Content Types - Rich content rendering for messages
export interface TableContent {
  data: any[];
  columns?: SpreadsheetColumn[];
  options?: TableFormatOptions;
}

export interface FormContent {
  fields: LegacyFormField[];
  validation?: ValidationRules;
  endpoint?: string;
}

export interface LegacyFormField {
  name: string;
  type: "text" | "textarea" | "number" | "date" | "boolean" | "select";
  label: string;
  description?: string;
  required?: boolean;
  value?: any;
  options?: { value: string; label: string }[]; // For select fields
}

export interface ValidationRules {
  [fieldName: string]: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    custom?: (value: any) => string | null; // Returns error message or null
  };
}

export interface ChartContent {
  type: "bar" | "pie" | "line" | "progress";
  data: ChartData;
  options?: ChartOptions;
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
  }[];
}

export interface ChartOptions {
  title?: string;
  width?: number;
  height?: number;
  responsive?: boolean;
  showLegend?: boolean;
  showValues?: boolean;
}

// Spreadsheet Types - Tabular data structures and processing
export interface SpreadsheetColumn {
  name: string;
  type: "text" | "number" | "currency" | "percentage" | "date";
  align?: "left" | "right" | "center";
  width?: string;
  formatter?: (value: any) => string;
}

export interface TableFormatOptions {
  title?: string;
  className?: string;
  showSummary?: boolean;
  exportable?: boolean;
  interactive?: boolean;
  zebra?: boolean;
  hover?: boolean;
}

export interface SpreadsheetData {
  [key: string]: string | number | boolean; // Flexible object structure for LLM-converted data
}

export interface SpreadsheetHistoryItem {
  sequenceNumber: number; // 1-based sequence number for easy reference (e.g., "spreadsheet 1")
  data: SpreadsheetData[] | null; // Array of objects representing spreadsheet rows (null if not yet converted)
  timestamp: string; // When this spreadsheet was created
  title?: string; // User-provided or auto-generated title
  source: SpreadsheetSource; // How this data was created
  metadata: SpreadsheetMetadata; // Always populated metadata for fast access
  sourceText?: string; // Original text for lazy conversion
  isConverted: boolean; // Whether data has been converted from sourceText
}

export interface TabularMetadata {
  hasTabularData: boolean;
  estimatedRowCount: number;
  estimatedColumnCount: number;
  dataFormat:
  | "csv"
  | "table"
  | "structured_text"
  | "natural_language"
  | "unknown";
  sampleFields: string[]; // First few detected field names
  complexity: "simple" | "moderate" | "complex";
  confidence: number; // 0-1 confidence in tabular detection
  conversionRequired: boolean; // Whether data needs LLM conversion
}

export interface SpreadsheetMetadata extends TabularMetadata {
  rowCount: number; // Actual count after conversion (0 if not converted)
  columnCount: number; // Actual count after conversion (0 if not converted)
  fieldNames: string[]; // Actual field names after conversion (empty if not converted)
  summary?: string; // LLM-generated summary of the data
}

export type SpreadsheetSource =
  | "user_paste" // User pasted text data
  | "csv_upload" // User uploaded CSV file
  | "excel_upload" // User uploaded Excel file
  | "vision_extraction" // Extracted from image
  | "llm_generated" // Created by LLM
  | "manual_entry" // Manual data entry
  | "direct_parameter" // Passed directly as tool parameter
  | "parameter_extraction"; // Extracted during parameter processing

// LLM Types - Language model interfaces and vision capabilities
export interface LLMUsageData {
  prompt_name: string;
  model_name: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_duration_ms: number;
  api_cost_usd?: number;
  success: boolean;
  error_message?: string;
}

export interface LLMResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface LLMResultWithUsage extends LLMResult {
  usage?: LLMUsageData;
  raw_response?: any;
}

export interface VisionAnalysisRequest {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  maxTokens?: number;
  temperature?: number;
}

export interface VisionAnalysisResult extends LLMResult {
  analysisData?: {
    description: string;
    confidence?: number;
    extractedData?: any[];
    detectedElements?: string[];
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

import type { Session } from "./sessionTypes";

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  returnType?: "json" | "text"; // Defaults to 'json' for 80% use case
  session?: Session; // Optional session for audit logging
  promptName?: string; // Optional name for tracking/audit
  userId?: string;
}

export interface LLMConfig {
  provider: string;
  model: string;
  visionModel: string;
  apiKeyEnv: string;
  temperature?: number;
  maxTokens?: number;
}

// Confirmation and Vision Types - User confirmation system
export interface ConfirmationPayload {
  toolId: string;
  toolName: string;
  sessionId: string;
  callbackFunction: string;
  confirmationMessage: string;
  context?: Record<string, any>;
  timestamp: number;
}

export interface ConfirmationChoice {
  label: string;
  value: string;
  style?: "primary" | "secondary" | "danger";
}

export interface ConfirmationRequest {
  message: string;
  choices?: ConfirmationChoice[];
  callbackFunction: string;
  context?: Record<string, any>;
}

export interface VisionData {
  description: string;
  summary: string;
  tables: any[];
  timestamp: string;
  source_message_id?: string;
  tableCount?: number;
  dataType?: string;
}

export interface VisionContext {
  latest: VisionData | null;
  history: VisionData[];
}

export interface ProcessConfirmationContext {
  type: "continue_process" | "decision_point" | "loop_limit" | "llm_limit";
  message: string;
  currentIteration: number;
  totalLLMCalls: number;
  pendingTasks: number;
  completedTasks: number;
  nextActions?: string[];
  timestamp: Date;
}

// Database Types
export interface Database {
  id: string;
  name: string;
  type: string;
  connection?: Record<string, any>;
}

