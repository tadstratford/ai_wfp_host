/**
 * Form Submission Handlers
 *
 * Type-specific handlers for different form submissions.
 * Values are stored as raw values in session parameters — the executor
 * wraps them in typed envelopes during prepareNodeParams when the tool re-runs.
 */

import type { Session } from "@backend/types";
import type { InteractiveFormMessage } from "@backend/types/formTypes";
import { getSession, saveSession } from "@backend/core/session";
import { getWorkflowById } from "@backend/core/workflow";

/**
 * Handle workflow prompt response
 *
 * User provided input via prompt form - store in parameters and resume workflow
 */
export async function handlePromptResponse(
    databaseId: string,
    session: Session,
    formMessage: InteractiveFormMessage,
    formData: Record<string, any>
): Promise<Session> {
    const { variableName } = formMessage.form.metadata || {};

    // Get the response value (typically first field)
    const responseValue = formData.response || formData[Object.keys(formData)[0]];

    // Store in session parameters for downstream nodes
    session.parameters = session.parameters || [];
    const varName = variableName || "userInput";

    // Set main response
    const existingVar = session.parameters.find(p => p.name === varName);
    if (existingVar) existingVar.value = responseValue;
    else session.parameters.push({ name: varName, value: responseValue, type: "string" });

    // Set lastPromptResponse
    const existingLast = session.parameters.find(p => p.name === "lastPromptResponse");
    if (existingLast) existingLast.value = responseValue;
    else session.parameters.push({ name: "lastPromptResponse", value: responseValue, type: "string" });

    // Clear waiting flag
    session.waitingForInput = false;

    // Add confirmation message
    session.messages.push({
        id: Date.now().toString(),
        role: "user",
        source: "form-response",
        html: `<div class="text-sm text-gray-700 dark:text-gray-300">Submitted</div>`,
        markdown: `Submitted: ${responseValue}`,
        timestamp: new Date()
    });

    // Resume workflow if paused
    if (session.metadata?.pausedAtNode && session.metadata?.workflow_id) {
        console.log(`[FormHandler] Resuming workflow from prompt response`);
        const { resumeWorkflow } = await import("@backend/core/workflow/executor");
        const workflow = await getWorkflowById(databaseId, session.metadata.workflow_id);

        if (workflow) {
            session = await resumeWorkflow(
                databaseId,
                workflow,
                session,
                responseValue,
                variableName || "userInput"
            );
        }
    }

    return session;
}

/**
 * Handle approval decision
 *
 * User approved or declined a workflow step
 */
export async function handleApprovalResponse(
    databaseId: string,
    session: Session,
    formMessage: InteractiveFormMessage,
    formData: Record<string, any>
): Promise<Session> {
    const { tracking_id, approval_id } = formMessage.form.metadata || {};
    const decision = formData.decision; // "approved" or "declined"
    const comments = formData.comments || "";

    console.log(`[FormHandler] Approval decision: ${decision} for tracking_id: ${tracking_id}`);

    // Clear waiting flag
    session.waitingForApproval = false;

    // Add confirmation message
    const isApproved = decision === "approved";
    session.messages.push({
        id: Date.now().toString(),
        role: "assistant",
        source: "approval-response",
        html: `<div class="text-sm ${isApproved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
      ${isApproved ? '✓' : '✗'} ${decision.toUpperCase()}
      ${comments ? `<div class="text-gray-600 dark:text-gray-400 mt-1">${comments}</div>` : ''}
    </div>`,
        markdown: `**${decision.toUpperCase()}**${comments ? `\n\n${comments}` : ''}`,
        timestamp: new Date()
    });

    // Resume workflow if approved
    if (isApproved && session.metadata?.pausedForApprovalAt && session.metadata?.workflow_id) {
        console.log(`[FormHandler] Resuming workflow after approval`);
        // Note: resumeAfterApproval not yet implemented — fall through
    } else if (!isApproved) {
        console.log(`[FormHandler] Workflow declined, stopping execution`);
    }

    return session;
}

/**
 * Handle parameter input (paste data from utils-upload or missing params)
 *
 * Stores all form fields as raw values in session parameters.
 * The tool re-runs on resume and processes the data.
 */
export async function handleParameterInput(
    databaseId: string,
    session: Session,
    formMessage: InteractiveFormMessage,
    formData: Record<string, any>
): Promise<Session> {
    console.log(`[FormHandler] Parameter input received:`, Object.keys(formData));

    // Store all form fields as parameters (raw values — tool wraps in envelope on re-run)
    session.parameters = session.parameters || [];
    for (const [key, value] of Object.entries(formData)) {
        const existing = session.parameters.find(p => p.name === key);
        if (existing) {
            existing.value = value;
        } else {
            session.parameters.push({ name: key, value, type: "string" });
        }
    }

    // Clear parameter gap flag
    if (session.metadata) {
        session.metadata.awaitingParameterInput = false;
    }

    // Add confirmation message
    session.messages.push({
        id: Date.now().toString(),
        role: "assistant",
        source: "parameter-input",
        html: `<div class="text-sm text-gray-700 dark:text-gray-300">Data received</div>`,
        markdown: `Data received`,
        timestamp: new Date()
    });

    // Resume workflow execution (re-runs the paused node)
    if (session.metadata?.pausedAtNode && session.metadata?.workflow_id) {
        console.log(`[FormHandler] Resuming workflow with parameters`);
        const { resumeWorkflow } = await import("@backend/core/workflow/executor");
        const workflow = await getWorkflowById(databaseId, session.metadata.workflow_id);

        if (workflow) {
            session = await resumeWorkflow(
                databaseId,
                workflow,
                session,
                "",
                ""
            );
        }
    }

    return session;
}

/**
 * Handle time entry submission
 *
 * User logged hours for a workflow step
 */
export async function handleTimeEntry(
    databaseId: string,
    session: Session,
    formMessage: InteractiveFormMessage,
    formData: Record<string, any>
): Promise<Session> {
    const { tracking_id, node_id } = formMessage.form.metadata || {};
    const hours = parseFloat(formData.hours);
    const description = formData.description || "";

    console.log(`[FormHandler] Time entry: ${hours} hours for tracking_id: ${tracking_id}`);

    // Add confirmation message
    session.messages.push({
        id: Date.now().toString(),
        role: "info",
        source: "time-entry",
        html: `<div class="text-sm text-green-600 dark:text-green-400">
      Logged ${hours} hour${hours !== 1 ? 's' : ''}
      ${description ? `<div class="text-gray-600 dark:text-gray-400 mt-1">${description}</div>` : ''}
    </div>`,
        markdown: `Logged ${hours} hour${hours !== 1 ? 's' : ''}${description ? `\n\n${description}` : ''}`,
        timestamp: new Date()
    });

    return session;
}

/**
 * Handle File Upload Submission
 *
 * Parses the uploaded file in memory, stores as __internal_uploadPayload,
 * then resumes the workflow (which re-runs the paused upload tool).
 */
export async function handleFileUploadResponse(
    databaseId: string,
    session: Session,
    formMessage: InteractiveFormMessage,
    formData: Record<string, any>
): Promise<Session> {
    console.log(`[FormHandler] Handling file upload`);

    // Find the file object in the formData
    let uploadedFile: File | undefined = undefined;

    for (const [key, value] of Object.entries(formData)) {
        if (value && typeof value === 'object' && ('arrayBuffer' in value || 'size' in value)) {
            uploadedFile = value as File;
            break;
        }
    }

    if (!uploadedFile) {
        throw new Error("No file data received in form payload. Did you properly select a file?");
    }

    const fileName = uploadedFile.name;
    const fileType = uploadedFile.type;

    try {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        let parsedData: any;

        // Determine if we need to parse as Excel/CSV or just text
        const isExcelOrCsv =
            fileName.endsWith('.csv') ||
            fileName.endsWith('.xlsx') ||
            fileName.endsWith('.xls') ||
            fileType?.includes('csv') ||
            fileType?.includes('excel') ||
            fileType?.includes('spreadsheet');

        if (isExcelOrCsv) {
            console.log(`[FormHandler] Parsing uploaded file as Excel/CSV array...`);
            const xlsx = require('xlsx');
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            parsedData = xlsx.utils.sheet_to_json(worksheet);
            console.log(`[FormHandler] Parsed ${parsedData.length} rows.`);
        } else if (fileName.endsWith('.json') || fileType?.includes('json')) {
            parsedData = JSON.parse(buffer.toString('utf8'));
        } else {
            console.log(`[FormHandler] Parsing uploaded file as pure text...`);
            parsedData = buffer.toString('utf8');
        }

        // Store as __internal_uploadPayload (the utils-upload tool reads this on re-run)
        session.parameters = session.parameters || [];
        const existingParam = session.parameters.find(p => p.name === "__internal_uploadPayload");
        if (existingParam) {
            existingParam.value = parsedData;
        } else {
            session.parameters.push({ name: "__internal_uploadPayload", value: parsedData, type: "object" });
        }

        // Add confirmation message
        const summary = Array.isArray(parsedData)
            ? `Parsed ${parsedData.length} rows of tabular data`
            : `Extracted ${Buffer.byteLength(buffer)} bytes of text`;

        session.messages.push({
            id: Date.now().toString(),
            role: "user",
            source: "form-response",
            html: `<div class="text-sm text-green-700 dark:text-green-300">
                <div class="flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                    <span>Uploaded: <strong>${fileName}</strong></span>
                </div>
                <div class="text-xs mt-1 text-green-600 opacity-80">${summary}</div>
            </div>`,
            markdown: `Uploaded: ${fileName} (${summary})`,
            timestamp: new Date()
        });

        // Resume workflow (re-runs the paused upload tool to process the data)
        if (session.metadata?.pausedAtNode && session.metadata?.workflow_id) {
            console.log(`[FormHandler] Resuming workflow after file upload`);
            const { resumeWorkflow } = await import("@backend/core/workflow/executor");
            const workflow = await getWorkflowById(databaseId, session.metadata.workflow_id);

            if (workflow) {
                session = await resumeWorkflow(
                    databaseId,
                    workflow,
                    session,
                    "File Uploaded",
                    "__internal_upload"
                );
            }
        }

        return session;
    } catch (e: any) {
        console.error(`[FormHandler] Failed to parse uploaded file: ${e.message}`);
        throw new Error(`File parsing failed: ${e.message}`);
    }
}
