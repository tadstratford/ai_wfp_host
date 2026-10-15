/**
 * Save Workspace — handles the save modal form submission.
 * Downloads the .wfp file and renames the workspace in one step.
 */
(function () {
  "use strict";

  function closeSaveModal() {
    var mc = document.getElementById("modal-container");
    if (mc) {
      mc.innerHTML = "";
      mc.classList.add("hidden");
    }
  }

  function setSaveStatus(msg, isError) {
    var el = document.getElementById("save-modal-status");
    if (!el) { if (isError) alert(msg); return; }
    el.textContent = msg;
    el.className =
      "mt-3 text-xs " +
      (isError ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400");
  }

  // Save to your account (encrypted Supabase row). The secret field is absent
  // for an already-saved workspace (no rotation) — the server reuses it.
  function saveToAccount(btn) {
    var nameEl = document.getElementById("save-account-name");
    var secretEl = document.getElementById("save-account-secret");
    var newSecretEl = document.getElementById("save-account-new-secret");
    var hintEl = document.getElementById("save-account-hint");

    var name = nameEl ? nameEl.value.trim() : "";
    if (!name) { setSaveStatus("Please enter a workspace name.", true); return; }
    var secret = secretEl ? secretEl.value : "";
    if (secretEl && secret.length < 4) {
      setSaveStatus("Secret must be at least 4 characters.", true);
      return;
    }
    var newSecret = newSecretEl ? newSecretEl.value : "";
    if (newSecretEl && newSecret.length > 0 && newSecret.length < 4) {
      setSaveStatus("New secret must be at least 4 characters.", true);
      return;
    }

    btn.disabled = true;
    btn.textContent = "Saving...";

    var params = new URLSearchParams();
    params.set("name", name);
    if (secretEl) params.set("secret", secret);
    if (newSecretEl && newSecret.length > 0) params.set("new_secret", newSecret);
    if (hintEl) params.set("secret_hint", hintEl.value.trim());

    fetch("/app/workspaces/save-to-account", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      credentials: "same-origin",
    })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || "Save failed"); });
        return r.text();
      })
      .then(function () {
        closeSaveModal();
        window.location.href = "/app";
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Save";
        setSaveStatus(err.message, true);
      });
  }

  // Save to disk — plaintext by default, encrypted if the checkbox is set.
  function saveToDisk(btn) {
    var nameInput = document.getElementById("save-disk-name");
    var name = (nameInput ? nameInput.value.trim() : "") || "workspace";
    var safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, "");

    var encryptCheckbox = document.getElementById("save-disk-encrypt");
    var passphraseInput = document.getElementById("save-disk-passphrase");
    var wantEncrypt = encryptCheckbox && encryptCheckbox.checked;
    var passphrase = passphraseInput ? passphraseInput.value : "";

    if (wantEncrypt && !passphrase) {
      setSaveStatus("Please enter a passphrase for encryption.", true);
      return;
    }

    btn.disabled = true;
    btn.textContent = "Saving...";

    var exportPromise;
    if (wantEncrypt) {
      var fd = new FormData();
      fd.append("passphrase", passphrase);
      exportPromise = fetch("/app/workspace/api/export", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
        return r.text();
      });
    } else {
      exportPromise = fetch("/app/workspace/api/export", { credentials: "same-origin" })
        .then(function (r) { return r.text(); });
    }

    exportPromise
      .then(function (text) {
        var blob = new Blob([text], { type: "text/plain" });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = safeName + ".wfp";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        closeSaveModal();
      })
      .catch(function (err) {
        console.error("[saveWorkspace] disk export error:", err);
        btn.disabled = false;
        btn.textContent = "Save";
        setSaveStatus("Save failed: " + err.message, true);
      });
  }

  // Confirm — dispatch on the destination radio.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#save-modal-confirm");
    if (!btn) return;
    var checked = document.querySelector('input[name="save-dest"]:checked');
    var dest = checked ? checked.value : "account";
    if (dest === "account") saveToAccount(btn);
    else saveToDisk(btn);
  });

  // Cancel button
  document.addEventListener("click", function (e) {
    if (e.target.closest("#save-modal-cancel")) closeSaveModal();
  });

  // Backdrop click
  document.addEventListener("click", function (e) {
    if (e.target.id === "save-modal-backdrop") closeSaveModal();
  });

  // Toggle disk-encryption passphrase row visibility
  document.addEventListener("change", function (e) {
    if (e.target.id === "save-disk-encrypt") {
      var row = document.getElementById("save-disk-passphrase-row");
      if (row) {
        row.classList.toggle("hidden", !e.target.checked);
        if (e.target.checked) {
          var inp = document.getElementById("save-disk-passphrase");
          if (inp) inp.focus();
        }
      }
    }
  });

  // Enter key in any save-modal field triggers the confirm button
  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Enter" &&
      (e.target.id === "save-account-name" ||
        e.target.id === "save-account-secret" ||
        e.target.id === "save-account-hint" ||
        e.target.id === "save-disk-name" ||
        e.target.id === "save-disk-passphrase")
    ) {
      e.preventDefault();
      var btn = document.getElementById("save-modal-confirm");
      if (btn) btn.click();
    }
  });

  // Open file picker helper (used by the Open button on the app page).
  window.openWfpFile = function (inp) {
    var f = inp.files[0];
    if (!f) return;
    inp.value = "";

    if (!confirm("Replace current workspace data?")) return;

    doImport(f, false);
  };

  // Download workspace as .wfp (used by workspace panel inline export)
  window.downloadWorkspace = function () {
    var nameInput = document.getElementById("wfp-filename");
    var name = (nameInput ? nameInput.value.trim() : "") || "workspace";
    fetch("/app/workspace/api/export", { credentials: "same-origin" })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var blob = new Blob([text], { type: "text/plain" });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name + ".wfp";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      });
  };

  // Import .wfp — preview first, then confirm
  window.importWfpFile = function (inp) {
    var f = inp.files[0];
    if (!f) return;
    inp.value = "";

    // Store file for later import
    window._pendingWfpFile = f;

    // Step 1: Get preview
    var fd = new FormData();
    fd.append("file", f);
    fetch("/app/workspace/api/import/preview", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    })
      .then(function (r) { return r.json(); })
      .then(function (preview) {
        if (preview.error) {
          alert("Cannot preview file: " + preview.error);
          return;
        }
        showImportPreview(preview, f);
      })
      .catch(function (e) { alert("Preview error: " + e); });
  };

  function showImportPreview(preview, file) {
    var target = document.getElementById("import-preview");
    if (!target) { doImport(file, preview.encrypted); return; }

    var html = '<div class="mt-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900">';
    html += '<h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Import Preview</h3>';

    if (preview.encrypted) {
      html += '<p class="text-sm text-gray-500 dark:text-gray-400 mb-3">This file is encrypted. Contents cannot be previewed.</p>';
    } else {
      if (preview.workspaceName) {
        html += '<p class="text-sm text-gray-600 dark:text-gray-300 mb-2">Workspace: <strong>' + escHtml(preview.workspaceName) + '</strong></p>';
      }

      html += '<div class="space-y-1 text-sm text-gray-500 dark:text-gray-400 mb-3">';
      if (preview.workflows.length > 0) {
        html += '<div>Workflows (' + preview.workflows.length + '): ';
        html += preview.workflows.map(function (w) { return escHtml(w.name); }).join(", ");
        html += '</div>';
      }
      if (preview.customTools.length > 0) {
        html += '<div>Custom Tools (' + preview.customTools.length + '): ';
        html += preview.customTools.map(function (t) { return escHtml(t.name); }).join(", ");
        html += '</div>';
      }
      if (preview.sessions > 0) {
        html += '<div>Sessions: ' + preview.sessions + '</div>';
      }
      if (preview.userDataFiles.length > 0) {
        html += '<div>Data Files (' + preview.userDataFiles.length + '): ';
        html += preview.userDataFiles.map(function (d) { return escHtml(d.name) + ' (' + d.sizeKb + 'KB)'; }).join(", ");
        html += '</div>';
      }
      html += '</div>';

      // Custom code warning
      if (preview.hasCustomCode) {
        html += '<div class="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">';
        html += '<p class="text-sm text-yellow-800 dark:text-yellow-300 font-medium">This file contains custom code</p>';
        html += '<p class="text-xs text-yellow-700 dark:text-yellow-400 mt-1">Custom tools include executable code that will run on the server when workflows are executed. Only import files from sources you trust.</p>';
        html += '</div>';
      }
    }

    html += '<p class="text-xs text-gray-400 dark:text-gray-500 mb-3">Loading this file will overwrite all current workspace data.</p>';

    html += '<div class="flex gap-2">';
    html += '<button onclick="confirmImport()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">Import</button>';
    html += '<button onclick="cancelImport()" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">Cancel</button>';
    html += '</div>';
    html += '</div>';

    target.innerHTML = html;
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  window.confirmImport = function () {
    var f = window._pendingWfpFile;
    if (!f) return;
    window._pendingWfpFile = null;
    doImport(f, false);
  };

  window.cancelImport = function () {
    window._pendingWfpFile = null;
    var target = document.getElementById("import-preview");
    if (target) target.innerHTML = "";
  };

  function doImport(file, maybeEncrypted) {
    var passphrase = "";

    // Read file to check encryption
    var rd = new FileReader();
    rd.onload = function (e) {
      var txt = e.target.result;
      var enc = maybeEncrypted || txt.indexOf('"wfp_encrypted":true') !== -1;

      if (enc) {
        passphrase = prompt("This file is encrypted. Enter passphrase:");
        if (!passphrase) return;
      }

      var fd = new FormData();
      fd.append("file", file);
      if (passphrase) fd.append("passphrase", passphrase);
      fetch("/app/workspace/api/import", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      })
        .then(function (r) {
          if (r.ok) {
            window.location.href = "/app";
          } else {
            r.text().then(function (t) { alert("Import failed: " + t); });
          }
        })
        .catch(function (e) { alert("Import error: " + e); });
    };
    rd.readAsText(file);
  }

  // Logout with save prompt
  window.logoutWithSavePrompt = function () {
    if (confirm("Download your .wfp file before logging out?")) {
      window.location.href = "/app/workspace/api/export?then=logout";
    } else {
      window.location.href = "/auth/logout";
    }
  };

  // New workspace helper (used by "New Workspace" button on workspace page)
  // Warns user, clears old workspace, creates fresh one, then opens the modal.
  window.startNewWorkspace = function () {
    // Check if workspace has data by looking at the counts in the DOM
    var countsEl = document.querySelector('[data-workspace-has-data]');
    var hasData = countsEl && countsEl.getAttribute('data-workspace-has-data') === 'true';

    function doCreate() {
      fetch("/app/workspace/api/new", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "workspace_name=My+Workspace",
        credentials: "same-origin",
      }).then(function () {
        // Update sidebar label
        var label = document.getElementById("workspace-name-label");
        if (label) label.textContent = "My Workspace";
        // Refresh the workspace page to show empty state with action buttons
        if (typeof htmx !== "undefined") {
          htmx.ajax("GET", "/app/workspace", { target: "#main-panel", swap: "innerHTML" });
        }
      });
    }

    if (hasData) {
      if (confirm("This will replace your current workspace. Make sure you have saved your .wfp file first.\n\nContinue?")) {
        doCreate();
      }
    } else {
      doCreate();
    }
  };

  // Legacy new workspace (blank reset without modal)
  window.newWorkspace = function () {
    if (confirm("Create a new empty workspace?")) {
      fetch("/app/workspace/api/new", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "workspace_name=My+Workspace",
        credentials: "same-origin",
      }).then(function () {
        window.location.reload();
      });
    }
  };
})();
