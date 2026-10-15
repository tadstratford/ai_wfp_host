/**
 * Universal Interactive Form System - Type Definitions
 * 
 * This module defines all types for the unified form system that handles:
 * - Workflow prompts
 * - Approval requests
 * - Parameter input collection
 * - Time entry
 */

import type { Message } from "./sessionTypes";

/**
 * Form types - determines behavior and routing
 */
export type FormType = "prompt" | "approval" | "timeEntry" | "parameterInput" | "fileUpload";

/**
 * Interactive form message - extends base Message type
 */
export interface InteractiveFormMessage extends Omit<Message, 'form'> {
  role: "form"; // Must be specifically "form"
  formId: string;
  formType: FormType;
  form: FormDefinition;
}

/**
 * Complete form definition
 */
export interface FormDefinition {
  title: string;
  description?: string;
  fields: FormField[];
  submitAction: FormSubmitAction;
  metadata?: Record<string, any>; // Context for form processing
}

/**
 * Form submission configuration
 */
export interface FormSubmitAction {
  endpoint: string;
  method: "POST";
  onSuccess: "resume" | "reload" | "continue";
}

/**
 * Validation rules for form fields
 */
export interface FormValidationRule {
  min?: number;
  max?: number;
  pattern?: string;
  customMessage?: string;
}

/**
 * Base field properties shared by all field types
 */
export interface BaseFormField {
  name: string;
  label: string;
  required: boolean;
  defaultValue?: any;
  helpText?: string;
  validation?: FormValidationRule;
}

/**
 * Text input field (text, email, url)
 */
export interface TextFormField extends BaseFormField {
  type: "text" | "email" | "url";
  placeholder?: string;
  maxLength?: number;
}

/**
 * Number input field
 */
export interface NumberFormField extends BaseFormField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

/**
 * TextArea field for multi-line input
 */
export interface TextAreaFormField extends BaseFormField {
  type: "textarea";
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}

/**
 * Select dropdown field
 */
export interface SelectFormField extends BaseFormField {
  type: "select";
  options: Array<{ label: string; value: any }>;
}

/**
 * Radio button group
 */
export interface RadioFormField extends BaseFormField {
  type: "radio";
  options: Array<{ label: string; value: any }>;
}

/**
 * Checkbox field (single boolean)
 */
export interface CheckboxFormField extends BaseFormField {
  type: "checkbox";
}

/**
 * Confirm buttons (Yes/No, Approve/Decline, etc.)
 */
export interface ConfirmFormField extends BaseFormField {
  type: "confirm";
  options: [
    { label: string; value: string; style?: "success" | "danger" | "primary" | "secondary" },
    { label: string; value: string; style?: "success" | "danger" | "primary" | "secondary" }
  ];
}

/**
 * Date input field
 */
export interface DateFormField extends BaseFormField {
  type: "date";
  min?: string; // ISO date string
  max?: string; // ISO date string
}

/**
 * Time input field
 */
export interface TimeFormField extends BaseFormField {
  type: "time";
  min?: string; // HH:mm format
  max?: string; // HH:mm format
}

/**
 * File input field for uploads
 */
export interface FileFormField extends BaseFormField {
  type: "file";
  accept?: string; // Comma-separated list of allowed file extensions or MIME types
  maxSizeBytes?: number; // Optional size limit in bytes
}

/**
 * Union type of all possible form fields
 */
export type FormField =
  | TextFormField
  | NumberFormField
  | TextAreaFormField
  | SelectFormField
  | RadioFormField
  | CheckboxFormField
  | ConfirmFormField
  | DateFormField
  | TimeFormField
  | FileFormField;

/**
 * Validation error structure
 */
export interface FormValidationError {
  field: string;
  message: string;
}

/**
 * Form submission result
 */
export interface FormSubmissionResult {
  success: boolean;
  errors?: FormValidationError[];
  action?: "resume" | "reload" | "continue";
  data?: Record<string, any>;
}
