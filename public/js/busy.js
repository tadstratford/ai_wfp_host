/**
 * Global busy indicator.
 *
 * A single counter-backed entry point (window.WFP.busy) that any process —
 * client JS or server code — can use to show/hide a spinner + status label in
 * the top bar. The counter makes nested/overlapping operations safe: the
 * spinner only hides when every "on" has been matched by an "off". A parallel
 * label stack keeps the most-recent message visible until its operation ends.
 *
 * Three ways the counter is driven:
 *   1. HTMX requests  — `htmx:beforeRequest` / `afterRequest` / `sendError` /
 *      `responseError` are wired automatically, so every HTMX-driven action
 *      (nav, forms, buttons) is covered with no extra code.
 *   2. SSE busy events — a dedicated EventSource on /app/sse listens for
 *      `busy_start` / `busy_end` emitted by long-running server processes
 *      (LLM runs, workflow execution, builds, the email agent) that outlive
 *      the original HTTP request. `busy_start` may carry a `data` label.
 *   3. Direct calls    — `WFP.busy.on(label?)` / `WFP.busy.off()` /
 *      `WFP.busy.with(promise, label?)` for any arbitrary process.
 */
(function () {
  "use strict";

  var count = 0;
  var labels = [];

  function el() {
    return document.getElementById("global-busy");
  }

  function labelEl() {
    return document.getElementById("global-busy-label");
  }

  function render() {
    var node = el();
    if (!node) return;
    if (count > 0) {
      node.classList.remove("hidden");
      var label = labelEl();
      if (label) {
        var text = labels[labels.length - 1];
        label.textContent = text || "Working…";
      }
    } else {
      node.classList.add("hidden");
    }
  }

  function on(label) {
    count++;
    labels.push(label || "Working…");
    render();
  }

  function off() {
    if (count > 0) count--;
    if (labels.length > 0) labels.pop();
    render();
  }

  function with_(promise, label) {
    on(label);
    var settle = function () { off(); };
    if (promise && typeof promise.then === "function") {
      promise.then(settle, settle);
    } else {
      settle();
    }
    return promise;
  }

  var busy = { on: on, off: off, with: with_ };

  window.WFP = window.WFP || {};
  window.WFP.busy = busy;

  // ── HTMX auto-wiring ────────────────────────────────────────────────────
  if (window.htmx) {
    document.addEventListener("htmx:beforeRequest", function () { on("Working…"); });
    document.addEventListener("htmx:afterRequest", off);
    document.addEventListener("htmx:sendError", off);
    document.addEventListener("htmx:responseError", off);
  }

  // ── SSE busy events ─────────────────────────────────────────────────────
  // htmx-ext-sse only forwards named events to elements with hx-trigger/sse-swap,
  // so open a dedicated source here and listen directly.
  function connect() {
    var create = (window.htmx && window.htmx.createEventSource) || null;
    if (!create) return;
    var source = create("/app/sse");
    source.addEventListener("busy_start", function (e) {
      var label = "Working…";
      try {
        var parsed = JSON.parse(e.data || "{}");
        if (parsed && typeof parsed.data === "string" && parsed.data) {
          label = parsed.data;
        }
      } catch (err) { /* keep default label */ }
      on(label);
    });
    source.addEventListener("busy_end", off);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect);
  } else {
    connect();
  }
})();
