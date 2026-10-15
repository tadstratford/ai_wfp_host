/**
 * Type definitions for AI-powered tool generation
 */

import type { ToolDefinition } from "./toolTypes";

/**
 * Request to generate a new tool
 */
export interface ToolGenerationRequest {
    description: string;
    category?: "accounting" | "ai" | "integrations" | "files" | "utils" | "other";
    inputExample?: string;
    outputExample?: string;
    similarToolIds?: string[];
    constraints?: {
        maxExecutionTime?: number;
        requiresApproval?: boolean;
        budgetedHours?: number;
    };
}

/**
 * Generated tool with code and metadata
 */
export interface GeneratedTool {
    toolId: string;
    name: string;
    code: string;
    definition: ToolDefinition;
    confidence: number; // 0-100
    warnings: string[];
    estimatedComplexity: "simple" | "medium" | "complex";
}

/**
 * Code validation result
 */
export interface ValidationResult {
    isValid: boolean;
    confidenceScore: number; // 0-100
    errors: string[];
    warnings: string[];
}

/**
 * Tool creation context stored in session metadata
 */
export interface ToolCreationContext {
    description: string;
    category?: string;
    requirements: string[];
    inputExample?: string;
    outputExample?: string;
    generatedCode?: string;
    toolId?: string;
    toolName?: string;
    confidence?: number;
    warnings?: string[];
    stage: ToolCreationStage;
}

/**
 * Stages of tool creation conversation
 */
export type ToolCreationStage =
    | "initial"      // First request
    | "refining"     // Gathering requirements
    | "generating"   // Creating code
    | "reviewing"    // User reviewing code
    | "saving"       // Finalizing
    | "complete";    // Tool saved

/**
 * Example tool for prompt context
 */
export interface ToolExample {
    toolId: string;
    code: string;
    definition: ToolDefinition;
}
