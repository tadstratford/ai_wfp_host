import { WorkflowNode } from "./workflowTypes";
// WorkflowNode is used by WorkflowExecution below
import type { FormDefinition } from "./formTypes";

/**
 * Session parameter with type information
 */
export interface SessionParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  default?: any;
  value: any;
}

/**
 * Represents a single workflow execution with its own isolated state
 */
export interface WorkflowExecution {
  workflowId: string;
  workflowName?: string;           // Cached for display
  nodes: WorkflowNode[];           // Snapshot of workflow nodes

  // Execution state
  visitedNodes: string[];          // Track which nodes have been executed
  currentNodeId?: string;          // Currently executing node
  pauseReason?: 'approval' | 'input' | 'scheduled';
  pausedAt?: string;               // Node ID where paused

  // Tracking
  trackingId?: string;             // Current step tracking ID

  // Timestamps
  startedAt: Date;
  completedAt?: Date;

  // Workflow-specific metadata (approval tokens, etc.)
  metadata: Record<string, any>;
}

export interface SessionPrompt {
  agent_name: string;
  knowledge_names: string[];
  slots: Record<string, string>;
}

export interface Session {
  session_id: string;
  createdAt: Date;
  updatedAt: Date;
  sessionName?: string;

  // Workflow registry - a session can run multiple workflows sequentially or on-demand
  workflows?: { [workflowId: string]: WorkflowExecution };
  activeWorkflowId?: string;      // Which workflow is currently executing

  // Instance fields
  client_id?: number | null;
  month?: string | null;
  instance_status?: string | null;
  scheduled_start_date?: string | null;

  // Stateflect support for multiple workflows
  currentWorkflowIndex: number;  // Index of current node being executed in workflow
  currentActionIndex?: number; // Added to match DB and usage
  currentUserMessage?: string;
  selectedCategories?: string[];
  selectedTools?: string[];
  user_id?: string; // User ID for workflow management tracking
  //---
  // Workflow State & Stack
  actions: Action[];         // LLM-driven actions (separate from workflow)
  messages: Message[];
  parameters?: SessionParameter[]; // NEW: Array of typed parameters instead of Record
  tasks?: Task[]; // LLM-driven workflow execution
  //---
  awaitingParameterInput?: boolean; // Flag to indicate process should pause for parameter input
  awaitingProcessConfirmation?: boolean; // Flag to indicate process should pause for user confirmation
  processConfirmationContext?: ProcessConfirmationContext; // Context for process continuation
  metadata?: Record<string, any>; // Additional session metadata for rules and workflows
  memoryContext: string; // Formatted memory context for LLM prompts (defaults to empty)
  relevantMemories?: any; // Raw memory graph data for session use
  pendingMemories?: any; // Memory updates awaiting user confirmation
  pendingMemoriesContext?: any; // Context for pending memory creation
  visionContext?: VisionContext; // Vision analysis data for clean tool access
  spreadsheet_history?: SpreadsheetHistoryItem[]; // Event-driven spreadsheet storage with sequence numbers
  currentPrompt?: CurrentPrompt; // Markdown-formatted prompt built incrementally during processing
  currentConfirmationId?: string; // ID of latest confirmation request to prevent stale responses
  currentRuleId?: string; // ID of the rule version used in this session for debugging and tracking
  processConfig?: ProcessConfig; // Configuration settings for the processing flow
  currentStatus?: string; // Current processing status for display in status banner
  waitingForInput?: boolean; // Flag indicating workflow is paused waiting for user input (prompt tool)
  waitingForApproval?: boolean; // Flag indicating workflow is paused waiting for approval
  waitingForManualStart?: boolean; // Flag indicating workflow is paused waiting for manual start (scheduled)
  prompt?: SessionPrompt; // agent-based chat state

}

export interface ProcessConfig {
  maxIterations?: number; // Maximum process iterations before requiring confirmation (default: 5)
  maxLLMCalls?: number; // Maximum LLM calls before requiring confirmation (default: 10)
  taskProcessingMode?: "sequential" | "batch"; // Process tasks one-by-one or all together (default: sequential)
  enableUserRules?: boolean; // Use user-specific rules instead of memory context (default: true)
  parameterHandling?: "strict" | "lenient"; // How to handle missing parameters (default: strict)
}

export interface CurrentPrompt {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  format?: "json";
  promptName?: string;
}

export type Task = {
  id: number;
  task: string;
  applications: string[];
  completed: boolean;
};

// Enhanced content types for rich tool outputs
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

// Import types from spreadsheetHelpers
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

export interface Message {
  id: string;
  role: MessageRole;
  source: string;
  nodeId?: string;        // Workflow node ID that created this message
  nodeLabel?: string;     // Human-readable node label for easy reference
  html: string;
  markdown?: string;
  messageLinkMarkdown?: string;
  messageLinkHTML?: string;
  data?: Record<string, unknown>[];
  json?: Record<string, unknown>;
  timestamp: Date;
  imageData?: string;
  imageMetadata?: {
    filename?: string;
    mimeType?: string;
    size?: number;
  };
  llm_usage?: LLMUsageData;
  knowledgeUsed?: Array<{ name: string; scope: string; contentHash: string }>;
  toolId?: string;
  toolName?: string;
  applicationId?: string;
  confirmationId?: string;
  // Enhanced content types
  table?: TableContent;
  form?: FormContent | FormDefinition;
  formId?: string;
  formType?: string;
  chart?: ChartContent;
  /** Name of a template for re-renderable interactive output. */
  template?: string;
  /** Data passed to the template for rendering. */
  template_data?: unknown;
  /** Element catalog widget to mount (e.g. { name: "gl-accounts", mode: "edit" }). */
  element?: { name: string; mode?: string; params?: Record<string, string> };
}


export type MessageRole =
  | "user" // User input messages
  | "system" // Internal prompts and system operations
  | "tasks" // Task list updates and display
  | "assistant" // AI responses and summaries
  | "tool" // Tool execution results
  | "spreadsheet" // Spreadsheet data and metadata
  | "error" // Error messages
  | "info" // Informational messages
  | "audit" // Audit messages
  | "email_sent" // Email notification records
  | "chat_msg_sent" // Chat message injected by workflow node
  | "form" // Universal interactive form messages
  | "todo"; // Todo/task messages

// Legacy tool interface (database/JSON file shape). Superseded by the registry
// ToolDefinition in toolTypes.ts; kept as `LegacyToolDefinition` to avoid a name
// collision with the active type re-exported from `src/shared/types/index.ts`.
export interface LegacyToolDefinition {
  id?: string;
  name: string;
  description: string;
  application_id?: string; // Application UUID (required in database)
  application_name?: string; // Display name for the application (from JOIN)
  category: string;
  context: context[];
  parameters: ToolParameter[];
  code?: string; // The actual tool implementation (optional in list views)
  tool_spec?: string; // Additional documentation/specification as text
  test_parameters?: Record<string, any>;
  version_number?: number;
  created_by?: string;
  showProgress?: boolean; // Flag to enable todo progress tracking
}

// // Application definition for organizing tools
// export interface Application {
//   id?: string; // UUID generated during creation
//   name: string; // Application name
//   description: string; // What this application does
//   enabled: boolean; // Whether application is active
//   prompt?: string; // Rich prompt explaining application capabilities and usage
//   capabilities?: string; // JSON string describing what the application can do
//   use_cases?: string; // JSON string with examples of when to use this application
//   metadata?: string; // JSON string with additional application metadata
//   category?: string; // Optional grouping category
//   version?: string; // Optional version number
//   created_at?: string; // Creation timestamp
//   updated_at?: string; // Last update timestamp
//   toolCount?: number; // Number of tools in this application (used in list views)
// }

// All tools are now session-aware with clean session in/out pattern

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolOut {
  success: boolean;
  content: string;
  toolName: string;
  data?: Record<string, unknown>[];
  json?: Record<string, unknown>;
}

export interface context {
  toolName: string; // what tools produce the context background i need.
}

export interface Action {
  tool_id: string;
  action_id: "string"; // uuid
  toolName?: string; // For backward compatibility with frontend
  toolParameters?: Record<string, any>;
}

// Spreadsheet data structure following LLM-First JSON approach
export interface SpreadsheetData {
  [key: string]: string | number | boolean; // Flexible object structure for LLM-converted data
}

// Event-driven spreadsheet storage with sequence-based identification
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

export interface ToolVersion {
  id: string;
  tool_id: string;
  version_number: number;
  name: string;
  description: string;
  application_id?: string;
  application_name?: string; // From JOIN with applications table
  category: string;
  context: context[];
  parameters: ToolParameter[];
  code: string;
  test_parameters?: Record<string, any>;
  created_by?: string;
  change_reason?: string;
  archived_at: Date;
  enabled?: boolean; // Optional enabled flag for tool versions
}

//---------------

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

// Clean LLM Interface Types
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  returnType?: "json" | "text"; // Defaults to 'json' for 80% use case
  session?: Session; // Optional session for audit logging
  promptName?: string; // Optional name for tracking/audit
}

export interface LLMConfig {
  provider: string;
  model: string;
  visionModel: string;
  apiKeyEnv: string;
  temperature?: number;
  maxTokens?: number;
}

// Tool Confirmation System Types
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

export interface Database {
  id: string;
  name: string;
  type: string;
  connection?: Record<string, any>;
}


