/**
 * Workflow DOM Helper Utilities
 * Minimal client-side JavaScript for HTMX-based workflow UI
 */

window.editWorkflow = (id, name, description) => {
  document.getElementById('edit-workflow-id').value = id;
  document.getElementById('edit-workflow-name').value = name;
  document.getElementById('edit-workflow-description').value = description;
  document.getElementById('edit-workflow-dialog').showModal();
};

window.saveWorkflowFromDialog = async () => {
  const id = document.getElementById('edit-workflow-id').value;
  const name = document.getElementById('edit-workflow-name').value.trim();
  const description = document.getElementById('edit-workflow-description').value;

  if (!name) {
    alert('Workflow name is required.');
    return;
  }

  try {
    const res = await fetch('/workflow/modal/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow_id: id, name, description })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      document.getElementById('edit-workflow-dialog').close();
      htmx.ajax('GET', '/workflow/workflowList', { target: '#right-panel', swap: 'innerHTML' });
    }
  } catch (e) {
    alert('Error saving workflow.');
  }
};

// ── Custom Tool List Dialog Helpers ───────────────────────────────────────────

window.editCustomTool = (id, name, description) => {
  document.getElementById('edit-tool-id').value = id;
  document.getElementById('edit-tool-name').value = name;
  document.getElementById('edit-tool-description').value = description;
  document.getElementById('edit-custom-tool-dialog').showModal();
};

window.saveCustomToolFromDialog = async () => {
  const id = document.getElementById('edit-tool-id').value;
  const name = document.getElementById('edit-tool-name').value.trim();
  const description = document.getElementById('edit-tool-description').value;
  if (!name) { alert('Tool name is required.'); return; }
  try {
    const res = await fetch('/custom-tools/modal/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_id: id, name, description })
    });
    const data = await res.json();
    if (data.error) { alert(data.error); }
    else {
      document.getElementById('edit-custom-tool-dialog').close();
      htmx.ajax('GET', '/custom-tools/list', { target: '#right-panel', swap: 'innerHTML' });
    }
  } catch { alert('Error saving tool.'); }
};

// Helper: Set input value from button click (for parameter insertion)
document.addEventListener("DOMContentLoaded", () => {
  // Delegate click events for parameter value insertion buttons
  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-insert-value]");
    if (target) {
      const targetInputId = target.getAttribute("data-target-input");
      const valueToInsert = target.getAttribute("data-insert-value");

      if (targetInputId && valueToInsert) {
        const input = document.getElementById(targetInputId);
        if (input) {
          input.value = valueToInsert;
          input.focus();
        }
      }
    }
  });

  // Helper: Copy to clipboard with visual feedback
  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-copy-text]");
    if (target) {
      const textToCopy = target.getAttribute("data-copy-text");
      if (textToCopy) {
        // Decode HTML entities properly
        const parser = new DOMParser();
        const doc = parser.parseFromString(textToCopy, "text/html");
        const decodedText = doc.documentElement.textContent;

        navigator.clipboard
          .writeText(decodedText)
          .then(() => {
            // Show visual feedback
            const originalText = target.textContent;
            target.textContent = "✓ Copied!";
            setTimeout(() => {
              target.textContent = originalText;
            }, 1500);
          })
          .catch((err) => {
            console.error("Failed to copy:", err);
            const originalText = target.textContent;
            target.textContent = "✗ Failed";
            setTimeout(() => {
              target.textContent = originalText;
            }, 1500);
          });
      }
    }
  });

  // Helper: Copy workflow JSON to clipboard
  document.body.addEventListener("click", async (e) => {
    const target = e.target.closest(".copy-workflow-json");
    if (target) {
      const workflowId = target.getAttribute("data-workflow-json");
      if (workflowId) {
        try {
          // Fetch JSON from backend
          const response = await fetch("/workflow/graphPanel/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "export_json",
              workflow_id: workflowId,
            }),
          });

          const data = await response.json();

          if (data.ok && data.json) {
            // Copy to clipboard
            await navigator.clipboard.writeText(data.json);

            // Show visual feedback
            const originalText = target.textContent;
            target.textContent = "✓ Copied!";
            setTimeout(() => {
              target.textContent = originalText;
            }, 1500);
          } else {
            throw new Error("Failed to get JSON");
          }
        } catch (err) {
          console.error("Failed to copy workflow JSON:", err);
          const originalText = target.textContent;
          target.textContent = "✗ Failed";
          setTimeout(() => {
            target.textContent = originalText;
          }, 1500);
        }
      }
    }
  });

  // Helper: Close modal/dialog
  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-close-modal]");
    if (target) {
      const modal = target.closest(".fixed");
      if (modal) {
        modal.remove();
      }
    }
  });
});
