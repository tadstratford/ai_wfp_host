// Accounting tab switcher — generic show/hide for tabbed panels.
//
// Conventions (docs/CONVENTIONS.md): client-side JS lives here, not inline in
// JSX, and no HTML is built from strings. This only toggles visibility and the
// active-tab styling on elements the server already rendered.
//
// Markup contract (set by the server fragment):
//   buttons: <button data-tabbtn="GROUP" data-tabkey="KEY" onclick="wfpShowTab('GROUP','KEY')">
//   panels:  <div data-tabpanel="GROUP" data-tabkey="KEY" [class="hidden"]>
// The default-visible panel/button is rendered active server-side, so a tab is
// shown on first paint with no JS — this only handles clicks.

function wfpShowTab(group, key) {
  document.querySelectorAll('[data-tabpanel="' + group + '"]').forEach(function (panel) {
    panel.classList.toggle("hidden", panel.getAttribute("data-tabkey") !== key);
  });
  document.querySelectorAll('[data-tabbtn="' + group + '"]').forEach(function (btn) {
    var on = btn.getAttribute("data-tabkey") === key;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    // Active = blue text + blue underline; inactive = muted + transparent border.
    btn.classList.toggle("text-blue-600", on);
    btn.classList.toggle("dark:text-blue-400", on);
    btn.classList.toggle("border-blue-600", on);
    btn.classList.toggle("dark:border-blue-400", on);
    btn.classList.toggle("text-gray-500", !on);
    btn.classList.toggle("dark:text-gray-400", !on);
    btn.classList.toggle("border-transparent", !on);
  });
}

// Badge (pill) tab switcher — same data-tabbtn/data-tabpanel contract as
// wfpShowTab, but toggles filled-pill active/inactive styling. The default
// active button/panel is rendered active server-side so first paint needs no JS.
function wfpShowBadgeTab(group, key) {
  var ACTIVE = ["bg-indigo-600", "text-white", "border-indigo-600"];
  var INACTIVE = [
    "bg-white",
    "text-gray-600",
    "border-gray-300",
    "hover:bg-gray-50",
    "dark:bg-gray-800",
    "dark:text-gray-300",
    "dark:border-gray-600",
  ];
  document.querySelectorAll('[data-tabpanel="' + group + '"]').forEach(function (panel) {
    panel.classList.toggle("hidden", panel.getAttribute("data-tabkey") !== key);
  });
  document.querySelectorAll('[data-tabbtn="' + group + '"]').forEach(function (btn) {
    var on = btn.getAttribute("data-tabkey") === key;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    ACTIVE.forEach(function (c) { btn.classList.toggle(c, on); });
    INACTIVE.forEach(function (c) { btn.classList.toggle(c, !on); });
  });
}
