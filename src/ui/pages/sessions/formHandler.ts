import type { Context } from "hono";
import { getSession, saveSession } from "@backend/core/session";
import { validateFormData } from "@backend/core/forms/validateFormData";
import {
    handlePromptResponse,
    handleApprovalResponse,
    handleParameterInput,
    handleTimeEntry,
    handleFileUploadResponse,
} from "@backend/core/forms/handlers";
import type { InteractiveFormMessage } from "@backend/types/formTypes";
import type { User } from "@backend/types";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

/**
 * POST /chat/form/submit
 * Handle all interactive form submissions (prompts, approvals, time entry, parameter input)
 */
export const formSubmitHandler = async (c: Context): Promise<Response> => {
    try {
        const user = c.get("user") as User;
        const databaseId = user.currentDatabaseId;

        if (!databaseId) {
            return c.html(`<div class="text-red-600 text-sm p-2">No database selected</div>`);
        }

        const body = await c.req.parseBody();
        const { formId, sessionId, ...formData } = body;

        console.log(`[FormHandler] Received submission:`, { formId, sessionId, keys: Object.keys(formData) });

        if (!formId || !sessionId) {
            return c.html(`<div class="text-red-600 text-sm p-2">Missing form ID or session ID</div>`);
        }

        const session = await getSession(databaseId, sessionId as string);
        if (!session) {
            return c.html(`<div class="text-red-600 text-sm p-2">Session not found</div>`);
        }

        const formMessage = session.messages.find(
            (m) => m.role === "form" && (m as any).formId === formId
        ) as InteractiveFormMessage | undefined;

        if (!formMessage) {
            return c.html(`<div class="text-red-600 text-sm p-2">Form not found in session</div>`);
        }

        console.log(`[FormHandler] Form type: ${formMessage.formType}`);

        const errors = validateFormData(formMessage.form.fields, formData);
        if (errors.length > 0) {
            console.log(`[FormHandler] Validation failed:`, errors);
            const errorList = errors.map((e: any) => e.message || String(e)).join(", ");
            return c.html(`<div class="text-red-600 text-sm p-2 border border-red-200 rounded mt-2">Validation error: ${errorList}</div>`);
        }

        let updatedSession = session;

        try {
            switch (formMessage.formType) {
                case "prompt":
                    updatedSession = await handlePromptResponse(databaseId, session, formMessage, formData);
                    break;
                case "approval":
                    updatedSession = await handleApprovalResponse(databaseId, session, formMessage, formData);
                    break;
                case "parameterInput":
                    updatedSession = await handleParameterInput(databaseId, session, formMessage, formData);
                    break;
                case "timeEntry":
                    updatedSession = await handleTimeEntry(databaseId, session, formMessage, formData);
                    break;
                case "fileUpload":
                    updatedSession = await handleFileUploadResponse(databaseId, session, formMessage, formData);
                    break;
                default:
                    return c.html(`<div class="text-red-600 text-sm p-2">Unknown form type: ${formMessage.formType}</div>`);
            }
        } catch (handlerError: any) {
            console.error(`[FormHandler] Handler error:`, handlerError);
            return c.html(`<div class="text-red-600 text-sm p-2 border border-red-200 rounded mt-2">Error processing form: ${handlerError.message}</div>`);
        }

        const formIdx = updatedSession.messages.findIndex(
            (m: any) => m.role === "form" && m.formId === formId
        );
        if (formIdx !== -1) {
            (updatedSession.messages[formIdx] as any).role = "form-submitted";
        }

        await saveSession(databaseId, updatedSession);
        notifyClients(sessionId as string, "new_message");

        console.log(`[FormHandler] Form processed successfully`);
        return c.html("");

    } catch (error: any) {
        console.error(`[FormHandler] Unexpected error:`, error);
        return c.html(`<div class="text-red-600 text-sm p-2">Internal server error: ${error.message}</div>`);
    }
};
