/**
 * Form Data Validation Engine
 * 
 * Validates form submissions against field definitions
 */

import type { FormField, FormValidationError } from "@backend/types/formTypes";

/**
 * Validate form submission data against field definitions
 * 
 * @param fields - Form field definitions
 * @param data - Submitted form data
 * @returns Array of validation errors (empty if valid)
 */
export function validateFormData(
    fields: FormField[],
    data: Record<string, any>
): FormValidationError[] {
    const errors: FormValidationError[] = [];

    for (const field of fields) {
        const value = data[field.name];

        // Required field check
        if (field.required && (value === undefined || value === null || value === '')) {
            errors.push({
                field: field.name,
                message: `${field.label} is required`
            });
            continue; // Skip further validation if field is missing
        }

        // Skip validation for optional empty fields
        if (!field.required && !value) {
            continue;
        }

        // Type-specific validation
        switch (field.type) {
            case 'number':
                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    errors.push({ field: field.name, message: `${field.label} must be a valid number` });
                    break;
                }
                if (field.min !== undefined && numValue < field.min) {
                    errors.push({ field: field.name, message: `${field.label} must be at least ${field.min}` });
                }
                if (field.max !== undefined && numValue > field.max) {
                    errors.push({ field: field.name, message: `${field.label} must be at most ${field.max}` });
                }
                break;

            case 'email':
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) {
                    errors.push({ field: field.name, message: `${field.label} must be a valid email address` });
                }
                break;

            case 'url':
                try {
                    new URL(value);
                } catch {
                    errors.push({ field: field.name, message: `${field.label} must be a valid URL` });
                }
                break;

            case 'text':
            case 'textarea':
                if (field.maxLength && value.length > field.maxLength) {
                    errors.push({
                        field: field.name,
                        message: `${field.label} must be ${field.maxLength} characters or less`
                    });
                }
                break;

            case 'date':
                const dateValue = new Date(value);
                if (isNaN(dateValue.getTime())) {
                    errors.push({ field: field.name, message: `${field.label} must be a valid date` });
                    break;
                }
                if (field.min) {
                    const minDate = new Date(field.min);
                    if (dateValue < minDate) {
                        errors.push({
                            field: field.name,
                            message: `${field.label} must be on or after ${field.min}`
                        });
                    }
                }
                if (field.max) {
                    const maxDate = new Date(field.max);
                    if (dateValue > maxDate) {
                        errors.push({
                            field: field.name,
                            message: `${field.label} must be on or before ${field.max}`
                        });
                    }
                }
                break;

            case 'time':
                const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
                if (!timeRegex.test(value)) {
                    errors.push({ field: field.name, message: `${field.label} must be a valid time (HH:MM)` });
                }
                break;
        }

        // Custom pattern validation
        if (field.validation?.pattern) {
            try {
                const regex = new RegExp(field.validation.pattern);
                if (!regex.test(value)) {
                    errors.push({
                        field: field.name,
                        message: field.validation.customMessage || `${field.label} has an invalid format`
                    });
                }
            } catch (e) {
                console.error(`Invalid regex pattern for field ${field.name}:`, e);
            }
        }
    }

    return errors;
}

/**
 * Quick validation check - returns true if data is valid
 */
export function isFormDataValid(fields: FormField[], data: Record<string, any>): boolean {
    return validateFormData(fields, data).length === 0;
}
