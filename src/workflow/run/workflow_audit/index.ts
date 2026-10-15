import { randomUUID } from "node:crypto";
import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';
import {
  runStreamRuleAudit,
  type StreamAuditStatusReason,
} from '@backend/core/knowledge/classifierAudit';

/**
 * workflow_audit — the final step of every workflow.
 *
 * Checks the entire run stream against the workspace rules (`wfp.rules`) and
 * the rules presented in the workflow description, using a SINGLE Jev
 * classifier call. Workspace-rule failures are named by the classifier; a
 * presented-rule failure (which has no name) reports the generic label.
 *
 * The status reason is emitted as a message (`json.workflowAudit`); a trigger
 * adapter (email / run / chat) reads it and maps it to the terminal status.
 */

const STATUS_LABELS: Record<StreamAuditStatusReason, string> = {
  no_errors: "Workflow ran with no Errors",
  broke_workspace_rule: "Workflow broke a Workspace rule",
  broke_presented_rule: "Workflow broke a rule that was presented in the workflow",
  audit_unavailable: "Workflow audit could not run (no classifier key)",
};

export const Tool_run = async (api: WFP_API): Promise<Result> => {
  const workflow = api.getActiveWorkflow?.() ?? null;
  if (!workflow) {
    return { status: 'error', error: 'workflow_audit requires an active workflow.' };
  }

  const workspaceRules = api.getRules?.() ?? [];
  const presentedRules = workflow.description ?? '';

  if (workspaceRules.length === 0 && !presentedRules.trim()) {
    api.addMessage({
      role: 'tool',
      markdown: `✓ No rules declared for \`${workflow.name}\`.`,
      json: {
        workflowAudit: {
          auditId: randomUUID(),
          pack: workflow.name,
          subject: 'output',
          statusReason: 'no_errors' as const,
          statusLabel: STATUS_LABELS.no_errors,
          failedRule: null,
          model: null,
        },
      },
    });
    return { status: 'success' };
  }

  const classifierKey = await api.getClassifierKey?.();
  if (!classifierKey) {
    api.addMessage({
      role: 'tool',
      markdown: `FAILED AUDIT — ${STATUS_LABELS.audit_unavailable}`,
      json: {
        workflowAudit: {
          auditId: randomUUID(),
          pack: workflow.name,
          subject: 'output',
          statusReason: 'audit_unavailable' as const,
          statusLabel: STATUS_LABELS.audit_unavailable,
          failedRule: null,
          model: null,
        },
      },
    });
    return { status: 'success' };
  }

  const stream = api.getStream?.() ?? '';

  const report = await runStreamRuleAudit({
    workspaceRules,
    presentedRules,
    stream,
    apiKey: classifierKey,
  });

  const label = STATUS_LABELS[report.statusReason];

  const failedSuffix = report.failedRule ? ` (${report.failedRule})` : "";
  const markdown =
    report.statusReason === "no_errors"
      ? `✓ ${label}`
      : `FAILED AUDIT — ${label}${failedSuffix}`;

  api.addMessage({
    role: "tool",
    markdown,
    json: {
      workflowAudit: {
        auditId: randomUUID(),
        pack: workflow.name,
        subject: "output",
        statusReason: report.statusReason,
        statusLabel: label,
        failedRule: report.failedRule,
        detail: null,
        model: report.model,
      },
    },
  });

  // The verdict is emitted only — a trigger adapter (e.g. the email adapter)
  // reads it and maps it to the workflow's terminal status. The workflow is
  // trigger-agnostic and does not reach into email status itself.
  return { status: 'success' };
};

export const tool_definition = async (): Promise<ToolDefinition> => ({
    tool_id: 'workflow_audit',
    name: 'Audit Workflow',
    apiVersion: '1.0.0',
    description: 'Audit the entire run stream against the workspace rules (wfp.rules) and the rules presented in the workflow, via a single Jev classifier call.',
    description_md: `## What it does
Checks the entire run stream against the workspace rules (\`wfp.rules\`) and the
rules presented in the workflow description using a single Jev classifier call.
Emits a status reason:
- \`no_errors\` — Workflow ran with no Errors
- \`broke_workspace_rule\` — Workflow broke a Workspace rule
- \`broke_presented_rule\` — Workflow broke a rule that was presented in the workflow
- \`audit_unavailable\` — no classifier key (fail-closed)

## Outputs
- Posts a machine-audit message (PASS / FAILED AUDIT) with the status reason
  and any failed rule name.`,
    category: 'flow',
    inputs: [],
    outputs: [],
});
