/**
 * Template Variable Replacement Utility
 * 
 * Replaces {{variableName}} placeholders in templates with values from session.parameters
 */

import type { Session } from "@backend/types";

/**
 * Replace template variables in a string with session parameter values
 * 
 * Syntax: {{variableName}} → session.parameters.variableName
 * 
 * Examples:
 * - "Hello {{clientName}}" → "Hello Acme Corp"
 * - "Amount: ${{amount}}" → "Amount: $5000"
 * - "Date: {{reportDate}}" → "Date: 2024-02-15"
 * 
 * @param template - String containing {{variable}} placeholders
 * @param session - Session object with parameters
 * @returns Template with variables replaced
 */
export function replaceTemplateVariables(template: string, session: Session): string {
    if (!template) return template;

    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        const value = session.parameters?.[varName];

        // Return value if it exists, otherwise keep the placeholder
        if (value !== undefined && value !== null) {
            return String(value);
        }

        // Keep original placeholder if variable not found
        return match;
    });
}

/**
 * Replace template variables in an object's string properties
 * 
 * Useful for email templates with subject and body
 * 
 * @param obj - Object with string properties containing templates
 * @param session - Session object with parameters
 * @returns New object with variables replaced
 */
export function replaceTemplateInObject<T extends Record<string, any>>(
    obj: T,
    session: Session
): T {
    const result: any = {};

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            result[key] = replaceTemplateVariables(value, session);
        } else {
            result[key] = value;
        }
    }

    return result as T;
}

/**
 * Get all variable names used in a template
 * 
 * @param template - Template string
 * @returns Array of variable names
 */
export function getTemplateVariables(template: string): string[] {
    const matches = template.matchAll(/\{\{(\w+)\}\}/g);
    return Array.from(matches, m => m[1]);
}

/**
 * Validate that all required variables exist in session parameters
 * 
 * @param template - Template string
 * @param session - Session object
 * @returns Array of missing variable names (empty if all present)
 */
export function getMissingVariables(template: string, session: Session): string[] {
    const variables = getTemplateVariables(template);
    const missing: string[] = [];

    for (const varName of variables) {
        const param = session.parameters?.find(p => p.name === varName);
        if (!param || param.value === undefined || param.value === null) {
            missing.push(varName);
        }
    }

    return missing;
}
