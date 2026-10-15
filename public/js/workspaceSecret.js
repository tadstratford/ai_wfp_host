/**
 * Workspace secret — remember the workspace unlock secret in the browser so the
 * user isn't prompted again for workspaces that share the same secret.
 *
 * Stored in localStorage (cleared only if the user clears site data). The value
 * is written on a successful open/unlock and pre-filled into the secret field of
 * the open modal and the full-page Unlock form.
 *
 * Only fields marked with `data-wfp-secret-autofill` are touched, so the
 * "New workspace" create form is never auto-filled.
 */
(function () {
  "use strict";

  var KEY = "wfp_workspace_secret";

  function readSecret() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function writeSecret(value) {
    if (!value) return;
    try {
      localStorage.setItem(KEY, value);
    } catch (e) {
      /* ignore (private browsing / storage disabled) */
    }
  }

  function autofill() {
    var saved = readSecret();
    if (!saved) return;
    var inputs = document.querySelectorAll("input[data-wfp-secret-autofill]");
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i].value) inputs[i].value = saved;
    }
  }

  document.addEventListener("DOMContentLoaded", autofill);
  document.addEventListener("htmx:afterSwap", autofill);
  document.addEventListener("htmx:afterSettle", autofill);

  // HTMX open modal — save on success. A successful open responds with an
  // HX-Redirect header (no body swap); a wrong secret returns an error banner.
  document.addEventListener("htmx:afterRequest", function (evt) {
    var detail = evt.detail || {};
    var xhr = detail.xhr;
    if (!xhr) return;
    var redirect = null;
    try {
      redirect = xhr.getResponseHeader("HX-Redirect");
    } catch (e) {
      return;
    }
    if (!redirect) return;
    var elt = detail.elt;
    var form = elt && elt.closest ? elt.closest("form") : null;
    if (!form) return;
    var input = form.querySelector("input[data-wfp-secret-autofill]");
    if (input && input.value) writeSecret(input.value);
  });

  // Full-page Unlock form (plain POST, no HTMX) — save on submit. If the secret
  // is wrong the page re-renders and the user corrects it, re-saving on the next
  // successful submit.
  document.addEventListener("submit", function (evt) {
    var form = evt.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== "form") return;
    if (form.hasAttribute("hx-post")) return; // handled via htmx:afterRequest
    var input = form.querySelector("input[data-wfp-secret-autofill]");
    if (input && input.value) writeSecret(input.value);
  });
})();
