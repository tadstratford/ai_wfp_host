import type { User } from "@backend/types";

/**
 * Approval Actions Component
 * Fetches and displays current approval status from database
 * Shows appropriate UI based on status (pending/approved/declined/expired)
 */

interface ApprovalActionsProps {
  token: string;
  stepName: string;
  approverEmail: string;
  userEmail: string;
  isAdmin: boolean;
  sessionId: string;
}

export const ApprovalActions = ({
  token,
  stepName,
  approverEmail,
  userEmail,
  isAdmin,
  sessionId,
}: ApprovalActionsProps) => {
  // This component will be replaced by HTMX with the actual status
  // The hx-get will fetch the current approval status and render accordingly
  return (
    <div
      class="mt-4"
      hx-get={`/workflow-mgmt/api/approval-status-ui/${token}?stepName=${encodeURIComponent(stepName)}&approverEmail=${encodeURIComponent(approverEmail)}&userEmail=${encodeURIComponent(userEmail)}&isAdmin=${isAdmin}&sessionId=${sessionId}`}
      hx-trigger="load"
      hx-swap="outerHTML"
    >
      <div class="p-4 bg-ink/[0.03] dark:bg-white/[0.03] rounded-xl border border-ink/[0.08] dark:border-white/[0.08]">
        <div class="text-sm text-ink-600 dark:text-white/70">
          Loading approval status...
        </div>
      </div>
    </div>
  );
};
