// Emails page helpers — provides the delegated `[data-copy-email]` copy handler
// for the Emails section (the firm-shell cardMenu.js copy handler is not loaded
// in the workspace shell). The inbound test form itself is HTMX-driven and needs
// no JavaScript here.

document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-copy-email]");
  if (!el) return;
  e.preventDefault();
  var text = el.getAttribute("data-copy-email") || "";
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      var prev = el.textContent;
      el.textContent = "Copied";
      setTimeout(function () { el.textContent = prev; }, 1200);
    }).catch(fallback);
  } else {
    fallback();
  }
});
