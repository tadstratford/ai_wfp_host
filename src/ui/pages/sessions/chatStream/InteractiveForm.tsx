/**
 * Universal Interactive Form Component
 *
 * Renders all types of interactive forms (prompts, approvals, parameter input, time entry)
 */

import type { InteractiveFormMessage } from "@backend/types/formTypes";

interface InteractiveFormProps {
  message: InteractiveFormMessage;
  sessionId: string;
}

/**
 * Main form component - routes to appropriate renderer based on form type
 */
export const InteractiveForm = ({
  message,
  sessionId,
}: InteractiveFormProps) => {
  const { form, formId, formType } = message;

  // Color scheme based on form type
  const colorScheme = {
    prompt: {
      bg: "bg-sun-50 dark:bg-sun-900/20",
      border: "border-sun-200 dark:border-sun-800",
      text: "text-sun-700 dark:text-sun-300",
      btn: "bg-sun-500 hover:bg-sun-600 dark:bg-sun-600 dark:hover:bg-sun-500",
    },
    approval: {
      bg: "bg-brand-50 dark:bg-brand-900/20",
      border: "border-brand-200 dark:border-brand-800",
      text: "text-brand-700 dark:text-brand-300",
      btn: "bg-brand-500 hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500",
    },
    parameterInput: {
      bg: "bg-grape-50 dark:bg-grape-900/20",
      border: "border-grape-100 dark:border-grape-900",
      text: "text-grape-600 dark:text-grape-300",
      btn: "bg-grape-500 hover:bg-grape-600 dark:bg-grape-600 dark:hover:bg-grape-500",
    },
    timeEntry: {
      bg: "bg-leaf-50 dark:bg-leaf-900/20",
      border: "border-leaf-100 dark:border-leaf-900",
      text: "text-leaf-700 dark:text-leaf-300",
      btn: "bg-leaf-500 hover:bg-leaf-600 dark:bg-leaf-600 dark:hover:bg-leaf-500",
    },
    info: {
      bg: "bg-ink/[0.03] dark:bg-white/[0.03]",
      border: "border-ink/[0.08] dark:border-white/[0.08]",
      text: "text-ink-700 dark:text-white/80",
      btn: "bg-ink-600 hover:bg-ink-700 dark:bg-ink-700 dark:hover:bg-ink-600",
    },
  };

  const colors =
    colorScheme[formType as keyof typeof colorScheme] ||
    Object.values(colorScheme)[0];

  // Check if form has confirm buttons (no separate submit needed)
  const hasConfirmButtons = form.fields.some((f) => f.type === "confirm");

  // Check if form has file fields
  const hasFileField = form.fields.some((f) => f.type === "file");

  return (
    <div
      class={`form-message border ${colors.border} ${colors.bg} rounded-lg p-4 my-4`}
    >
      {/* Form Header */}
      <div class="form-header mb-4">
        <h4 class={`font-semibold ${colors.text} text-lg`}>{form.title}</h4>
        {form.description && (
          <p class="text-sm text-ink-600 dark:text-white/70 mt-1">
            {form.description}
          </p>
        )}
      </div>

      {/* Form Body */}
      <form
        id={`form-${formId}`}
        hx-post={form.submitAction.endpoint}
        hx-target="#chat-messages"
        hx-swap="beforeend"
        hx-indicator="#form-loading"
        hx-encoding={
          hasFileField
            ? "multipart/form-data"
            : "application/x-www-form-urlencoded"
        }
        enctype={
          hasFileField
            ? "multipart/form-data"
            : "application/x-www-form-urlencoded"
        }
        class="space-y-4"
      >
        <input type="hidden" name="formId" value={formId} />
        <input type="hidden" name="sessionId" value={sessionId} />

        {/* Render Fields */}
        {form.fields.map((field) => (
          <FormField field={field} />
        ))}

        {/* Submit Button (only shown for non-confirm fields) */}
        {!hasConfirmButtons && (
          <div class="flex justify-end gap-2 mt-4 pt-4 border-t border-ink/[0.07] dark:border-white/[0.07]">
            <button
              type="submit"
              class={`px-6 py-2 ${colors.btn} text-white rounded-xl font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              Submit
            </button>
          </div>
        )}

        {/* Loading indicator */}
        <div id="form-loading" class="htmx-indicator text-center py-2">
          <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-ink dark:border-white"></div>
        </div>
      </form>
    </div>
  );
};

/**
 * Individual form field component
 */
const FormField = ({ field }: { field: any }) => {
  const baseInputClasses =
    "w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition-colors";

  // Render based on field type
  let inputElement: any;

  switch (field.type) {
    case "text":
    case "email":
    case "url":
      inputElement = (
        <input
          type={field.type}
          name={field.name}
          value={field.defaultValue || ""}
          required={field.required}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          class={baseInputClasses}
        />
      );
      break;

    case "number":
      inputElement = (
        <input
          type="number"
          name={field.name}
          value={field.defaultValue || ""}
          required={field.required}
          min={field.min}
          max={field.max}
          step={field.step || 0.01}
          placeholder={field.placeholder}
          class={baseInputClasses}
        />
      );
      break;

    case "textarea":
      inputElement = (
        <textarea
          name={field.name}
          required={field.required}
          rows={field.rows || 3}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          class={baseInputClasses}
        >
          {field.defaultValue || ""}
        </textarea>
      );
      break;

    case "select":
      inputElement = (
        <select
          name={field.name}
          required={field.required}
          class={baseInputClasses}
        >
          <option value="">-- Select --</option>
          {field.options?.map((opt: any) => (
            <option
              value={opt.value}
              selected={opt.value === field.defaultValue}
            >
              {opt.label}
            </option>
          ))}
        </select>
      );
      break;

    case "radio":
      inputElement = (
        <div class="space-y-2">
          {field.options?.map((opt: any) => (
            <label class="flex items-center gap-2 cursor-pointer hover:bg-ink/[0.04] dark:hover:bg-white/[0.06] p-2 rounded">
              <input
                type="radio"
                name={field.name}
                value={opt.value}
                checked={opt.value === field.defaultValue}
                required={field.required}
                class="text-brand-600 focus:ring-2 focus:ring-brand-500"
              />
              <span class="text-sm text-ink-700 dark:text-white/80">
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      );
      break;

    case "checkbox":
      inputElement = (
        <label class="flex items-center gap-2 cursor-pointer hover:bg-ink/[0.04] dark:hover:bg-white/[0.06] p-2 rounded">
          <input
            type="checkbox"
            name={field.name}
            value="true"
            checked={field.defaultValue}
            class="rounded border-ink/[0.12] dark:border-white/[0.1] text-brand-600 focus:ring-2 focus:ring-brand-500"
          />
          <span class="text-sm text-ink-700 dark:text-white/80">
            {field.label}
          </span>
        </label>
      );
      break;

    case "confirm":
      const styleMap: Record<string, string> = {
        success:
          "bg-leaf-500 hover:bg-leaf-600 dark:bg-leaf-600 dark:hover:bg-leaf-500 focus:ring-leaf-500",
        danger:
          "bg-coral-500 hover:bg-coral-600 dark:bg-coral-600 dark:hover:bg-coral-500 focus:ring-coral-500",
        primary:
          "bg-brand-500 hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500 focus:ring-brand-500",
        secondary:
          "bg-ink-600 hover:bg-ink-700 dark:bg-ink-700 dark:hover:bg-ink-600 focus:ring-ink-500",
      };

      inputElement = (
        <div class="flex gap-3">
          {field.options?.map((opt: any) => {
            const btnClass =
              styleMap[opt.style || "primary"] || styleMap.primary;
            return (
              <button
                type="button"
                class={`flex-1 px-6 py-3 ${btnClass} text-white rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2`}
                onclick={`document.getElementById('${field.name}-hidden').value='${opt.value}'; this.closest('form').requestSubmit();`}
              >
                {opt.label}
              </button>
            );
          })}
          <input
            type="hidden"
            id={`${field.name}-hidden`}
            name={field.name}
            required={field.required}
          />
        </div>
      );
      break;

    case "date":
      inputElement = (
        <input
          type="date"
          name={field.name}
          value={field.defaultValue || ""}
          required={field.required}
          min={field.min}
          max={field.max}
          class={baseInputClasses}
        />
      );
      break;

    case "time":
      inputElement = (
        <input
          type="time"
          name={field.name}
          value={field.defaultValue || ""}
          required={field.required}
          min={field.min}
          max={field.max}
          class={baseInputClasses}
        />
      );
      break;

    case "file":
      inputElement = (
        <div class="relative">
          <input
            type="file"
            name={field.name}
            required={field.required}
            accept={field.accept}
            class="block w-full text-sm text-ink-500 dark:text-white/60 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 dark:file:bg-brand-900/40 dark:file:text-brand-300 dark:hover:file:bg-brand-900/60 transition-colors cursor-pointer"
          />
          {field.maxSizeBytes && (
            <p class="mt-1 text-xs text-ink-500">
              Max size: {Math.round(field.maxSizeBytes / 1024)}KB
            </p>
          )}
        </div>
      );
      break;

    default:
      inputElement = (
        <div class="text-coral-500">Unknown field type: {field.type}</div>
      );
  }

  // Don't show label for checkbox (it's inline) or confirm (buttons are self-labeled)
  if (field.type === "checkbox" || field.type === "confirm") {
    return <div class="form-field">{inputElement}</div>;
  }

  return (
    <div class="form-field">
      <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
        {field.label}
        {field.required && <span class="text-coral-500 ml-1">*</span>}
      </label>
      {field.helpText && (
        <p class="text-xs text-ink-500 mb-2">
          {field.helpText}
        </p>
      )}
      {inputElement}
    </div>
  );
};
