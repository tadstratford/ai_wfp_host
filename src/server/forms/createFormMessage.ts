/**
 * Universal Form Message Creator
 * 
 * Creates interactive form messages for collecting user input
 */

import type { Session } from "@backend/types";
import type {
    FormType,
    FormField,
    InteractiveFormMessage,
    FormDefinition
} from "@backend/types/formTypes";

/**
 * Configuration for creating a form message
 */
export interface CreateFormMessageConfig {
    formType: FormType;
    title: string;
    description?: string;
    fields: FormField[];
    metadata?: Record<string, any>;
}

/**
 * Create a universal interactive form message
 * 
 * @param session - Current session
 * @param config - Form configuration
 * @returns Updated session with form message added
 */
export async function createFormMessage(
    session: Session,
    config: CreateFormMessageConfig
): Promise<Session> {
    // Generate unique form ID
    const formId = `form-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Build form definition
    const formDefinition: FormDefinition = {
        title: config.title,
        description: config.description,
        fields: config.fields,
        submitAction: {
            endpoint: "/sessions/form/submit",
            method: "POST",
            onSuccess: "continue"
        },
        metadata: config.metadata || {}
    };

    // Render HTML for the form
    const html = renderFormHTML(formId, session.session_id, config.formType, formDefinition);
    const markdown = renderFormMarkdown(formDefinition);

    // Create the form message
    const formMessage: InteractiveFormMessage = {
        id: formId,
        role: "form",
        formId,
        formType: config.formType,
        source: "form-system",
        timestamp: new Date(),
        html,
        markdown,
        form: formDefinition
    };

    // Add to session messages
    session.messages.push(formMessage);

    return session;
}

/**
 * Render form as HTML
 */
function renderFormHTML(
    formId: string,
    sessionId: string,
    formType: FormType,
    form: FormDefinition
): string {
    // Color scheme based on form type
    const colorMap = {
        prompt: { bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-900 dark:text-amber-300", btn: "bg-amber-600 hover:bg-amber-700" },
        approval: { bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-200 dark:border-blue-800", text: "text-blue-900 dark:text-blue-300", btn: "bg-blue-600 hover:bg-blue-700" },
        parameterInput: { bg: "bg-purple-50 dark:bg-purple-900/20", border: "border-purple-200 dark:border-purple-800", text: "text-purple-900 dark:text-purple-300", btn: "bg-purple-600 hover:bg-purple-700" },
        timeEntry: { bg: "bg-green-50 dark:bg-green-900/20", border: "border-green-200 dark:border-green-800", text: "text-green-900 dark:text-green-300", btn: "bg-green-600 hover:bg-green-700" },
        fileUpload: { bg: "bg-indigo-50 dark:bg-indigo-900/20", border: "border-indigo-200 dark:border-indigo-800", text: "text-indigo-900 dark:text-indigo-300", btn: "bg-indigo-600 hover:bg-indigo-700" }
    };

    const colors = colorMap[formType];

    return `
    <div class="form-message border ${colors.border} ${colors.bg} rounded-lg p-4">
      <!-- Form Header -->
      <div class="form-header mb-4">
        <h4 class="font-semibold ${colors.text}">${form.title}</h4>
        ${form.description ? `<p class="text-sm text-gray-600 dark:text-gray-400 mt-1">${form.description}</p>` : ''}
      </div>
      
      <!-- Form Body -->
      <form
        id="${formId}"
        hx-post="${form.submitAction.endpoint}"
        hx-vals='{"formId": "${formId}", "sessionId": "${sessionId}"}'
        hx-target="#chat-messages"
        hx-swap="beforeend"
        class="space-y-4"
      >
        ${form.fields.map(field => renderFormField(field)).join('\n')}
        
        <!-- Submit Button (only shown for non-confirm fields) -->
        ${!form.fields.some(f => f.type === 'confirm') ? `
          <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="submit"
              class="px-6 py-2 ${colors.btn} text-white rounded-md font-medium transition-colors"
            >
              Submit
            </button>
          </div>
        ` : ''}
      </form>
    </div>
  `;
}

/**
 * Render individual form field
 */
function renderFormField(field: FormField): string {
    const baseClasses = "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500";

    let inputHTML = '';

    switch (field.type) {
        case 'text':
        case 'email':
        case 'url':
            inputHTML = `
        <input
          type="${field.type}"
          name="${field.name}"
          value="${field.defaultValue || ''}"
          ${field.required ? 'required' : ''}
          ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
          ${field.maxLength ? `maxlength="${field.maxLength}"` : ''}
          class="${baseClasses}"
        />
      `;
            break;

        case 'number':
            inputHTML = `
        <input
          type="number"
          name="${field.name}"
          value="${field.defaultValue || ''}"
          ${field.required ? 'required' : ''}
          ${field.min !== undefined ? `min="${field.min}"` : ''}
          ${field.max !== undefined ? `max="${field.max}"` : ''}
          ${field.step !== undefined ? `step="${field.step}"` : 'step="0.01"'}
          ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
          class="${baseClasses}"
        />
      `;
            break;

        case 'textarea':
            inputHTML = `
        <textarea
          name="${field.name}"
          ${field.required ? 'required' : ''}
          rows="${field.rows || 3}"
          ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
          ${field.maxLength ? `maxlength="${field.maxLength}"` : ''}
          class="${baseClasses}"
        >${field.defaultValue || ''}</textarea>
      `;
            break;

        case 'select':
            inputHTML = `
        <select
          name="${field.name}"
          ${field.required ? 'required' : ''}
          class="${baseClasses}"
        >
          <option value="">-- Select --</option>
          ${field.options.map(opt => `
            <option value="${opt.value}" ${opt.value === field.defaultValue ? 'selected' : ''}>
              ${opt.label}
            </option>
          `).join('')}
        </select>
      `;
            break;

        case 'radio':
            inputHTML = `
        <div class="space-y-2">
          ${field.options.map(opt => `
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="${field.name}"
                value="${opt.value}"
                ${opt.value === field.defaultValue ? 'checked' : ''}
                ${field.required ? 'required' : ''}
                class="text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <span class="text-sm text-gray-700 dark:text-gray-300">${opt.label}</span>
            </label>
          `).join('')}
        </div>
      `;
            break;

        case 'checkbox':
            inputHTML = `
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="${field.name}"
            value="true"
            ${field.defaultValue ? 'checked' : ''}
            class="rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-2 focus:ring-blue-500"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">${field.label}</span>
        </label>
      `;
            break;

        case 'confirm':
            inputHTML = `
        <div class="flex gap-2">
          ${field.options.map(opt => {
                const styleMap = {
                    success: 'bg-green-600 hover:bg-green-700',
                    danger: 'bg-red-600 hover:bg-red-700',
                    primary: 'bg-blue-600 hover:bg-blue-700',
                    secondary: 'bg-gray-600 hover:bg-gray-700'
                };
                const btnClass = styleMap[opt.style || 'primary'];
                return `
              <button
                type="button"
                class="flex-1 px-6 py-2 ${btnClass} text-white rounded-md font-medium transition-colors"
                onclick="document.getElementById('${field.name}-hidden').value='${opt.value}'; this.closest('form').requestSubmit();"
              >
                ${opt.label}
              </button>
            `;
            }).join('')}
          <input type="hidden" id="${field.name}-hidden" name="${field.name}" ${field.required ? 'required' : ''} />
        </div>
      `;
            break;

        case 'date':
            inputHTML = `
        <input
          type="date"
          name="${field.name}"
          value="${field.defaultValue || ''}"
          ${field.required ? 'required' : ''}
          ${field.min ? `min="${field.min}"` : ''}
          ${field.max ? `max="${field.max}"` : ''}
          class="${baseClasses}"
        />
      `;
            break;

        case 'time':
            inputHTML = `
        <input
          type="time"
          name="${field.name}"
          value="${field.defaultValue || ''}"
          ${field.required ? 'required' : ''}
          ${field.min ? `min="${field.min}"` : ''}
          ${field.max ? `max="${field.max}"` : ''}
          class="${baseClasses}"
        />
      `;
            break;
    }

    // Don't show label for checkbox (it's inline) or confirm (buttons are self-labeled)
    if (field.type === 'checkbox' || field.type === 'confirm') {
        return `<div class="form-field">${inputHTML}</div>`;
    }

    return `
    <div class="form-field">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        ${field.label}
        ${field.required ? '<span class="text-red-500 ml-1">*</span>' : ''}
      </label>
      ${field.helpText ? `<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">${field.helpText}</p>` : ''}
      ${inputHTML}
    </div>
  `;
}

/**
 * Render form as markdown (for non-interactive display)
 */
function renderFormMarkdown(form: FormDefinition): string {
    let md = `**${form.title}**\n`;
    if (form.description) {
        md += `\n${form.description}\n`;
    }
    md += `\n`;

    form.fields.forEach(field => {
        md += `- ${field.label}${field.required ? ' *' : ''}\n`;
    });

    return md;
}
