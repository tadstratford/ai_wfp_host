// Barrel export file - re-exports all types from domain-specific files
// This maintains backward compatibility with existing imports

// Context augmentation - must be imported first
import "./contextTypes";

// User types
export type { User } from "./userTypes";

// Auth types - permissions
export type { UserPermissions } from "./authTypes";


// Workflow types
export type {
  Workflow,
  WorkflowNodeType,
  WorkflowNode,
  WorkflowMgmt_Approvals,
  WorkflowMgmt_Budget,
  WorkflowMgmt_Email,
  WorkflowMgmt_ChatMsg,
} from "./workflowTypes";

// Session types - user interaction state and lifecycle
export type {
  Session,
  SessionParameter,
  Message,
  MessageRole,
  Task,
  ProcessConfig,
  CurrentPrompt,
  Action,
  ToolOut,
  context,
} from "./sessionTypes";

// Tool types - tool registry and execution
export type {
  ToolDefinition,
  ToolInput,
  ToolOutput
} from "./toolTypes";

// Other types - LLM, Spreadsheet, UI, Confirmation, Database
export type {
  // UI Content Types
  TableContent,
  FormContent,
  LegacyFormField, // Renamed from FormField to avoid collision with universal forms
  ValidationRules,
  ChartContent,
  ChartData,
  ChartOptions,
  // Spreadsheet Types
  SpreadsheetColumn,
  TableFormatOptions,
  SpreadsheetData,
  SpreadsheetHistoryItem,
  TabularMetadata,
  SpreadsheetMetadata,
  SpreadsheetSource,
  // LLM Types
  LLMUsageData,
  LLMResult,
  LLMResultWithUsage,
  VisionAnalysisRequest,
  VisionAnalysisResult,
  ChatMessage,
  LLMOptions,
  LLMConfig,
  // Confirmation and Vision Types
  ConfirmationPayload,
  ConfirmationChoice,
  ConfirmationRequest,
  VisionData,
  VisionContext,
  ProcessConfirmationContext,
  // Database Types
  Database,
} from "./otherTypes";

// Universal Form Types - New form system
export type {
  InteractiveFormMessage,
  FormDefinition,
  FormType,
  FormField,
  TextFormField,
  NumberFormField,
  TextAreaFormField,
  SelectFormField,
  RadioFormField,
  CheckboxFormField,
  ConfirmFormField,
  DateFormField,
  TimeFormField,
  FormSubmitAction,
  FormValidationRule,
  FormValidationError,
  FormSubmissionResult
} from "./formTypes";

// Reporting types - central fact table for reporting
export type {
  ReportingFact,
  ReportingFactInput,
  ApprovalUpdate,
  FactFilter,
  ReportingMetrics,
  UserMonthMetrics,
  ClientMonthMetrics,
  WorkflowMetrics,
} from "./reportingTypes";
