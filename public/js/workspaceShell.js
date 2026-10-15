/**
 * Workspace shell — left-sidebar behavior. Scoped to the workspace shell
 * (separate from navHelpers.js, whose popstate handler targets the legacy
 * /app?panel= URLs and must not run here).
 *
 * Handles:
 *   - Mobile drawer toggle (#ws-nav / #ws-nav-backdrop) via #ws-nav-toggle.
 *   - Desktop icon-collapse toggle (.ws-collapsed) via #ws-collapse-btn.
 *   - Active nav highlight synced from the URL (the nav is server-rendered
 *     once; HTMX panel swaps only replace #main-panel).
 */
(function () {
  "use strict";

  function closeNav() {
    var nav = document.getElementById("ws-nav");
    var backdrop = document.getElementById("ws-nav-backdrop");
    if (nav) nav.classList.add("-translate-x-full");
    if (backdrop) backdrop.classList.add("hidden");
  }

  window.toggleWsNav = function () {
    var nav = document.getElementById("ws-nav");
    var backdrop = document.getElementById("ws-nav-backdrop");
    if (!nav || !backdrop) return;
    var open = !nav.classList.contains("-translate-x-full");
    if (open) {
      closeNav();
    } else {
      nav.classList.remove("-translate-x-full");
      backdrop.classList.remove("hidden");
    }
  };

  window.toggleWsCollapse = function () {
    var nav = document.getElementById("ws-nav");
    if (!nav) return;
    nav.classList.toggle("ws-collapsed");
  };

  function initToggles() {
    var navToggle = document.getElementById("ws-nav-toggle");
    var collapseBtn = document.getElementById("ws-collapse-btn");
    var backdrop = document.getElementById("ws-nav-backdrop");
    if (navToggle) navToggle.addEventListener("click", window.toggleWsNav);
    if (collapseBtn) collapseBtn.addEventListener("click", window.toggleWsCollapse);
    if (backdrop) backdrop.addEventListener("click", closeNav);
  }

  // Tapping a nav link on mobile closes the drawer.
  document.addEventListener("click", function (e) {
    if (window.innerWidth >= 768) return;
    if (e.target.closest("#ws-nav a")) closeNav();
  });

  // ── Active nav highlight ──────────────────────────────────────────────────
  var NAV_BASE =
    "nav-tab flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer no-underline";
  var NAV_ACTIVE = "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300";
  var NAV_INACTIVE =
    "text-ink-600 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.06]";

  function syncActiveNav() {
    var path = location.pathname;
    var links = document.querySelectorAll(".nav-tab[data-nav-path]");
    var matched = null;
    links.forEach(function (el) {
      var target = el.getAttribute("data-nav-path");
      if (path === target || path.indexOf(target + "/") === 0) {
        matched = el;
      }
    });
    // No owning nav item (e.g. a sub-page without a top-level entry) — keep the
    // current highlight instead of clearing it.
    if (!matched) return;
    links.forEach(function (el) {
      el.className = NAV_BASE + " " + (el === matched ? NAV_ACTIVE : NAV_INACTIVE);
    });
  }

  function initActiveNav() {
    syncActiveNav();
    document.addEventListener("htmx:pushedIntoHistory", syncActiveNav);
    window.addEventListener("popstate", syncActiveNav);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initToggles);
    document.addEventListener("DOMContentLoaded", initActiveNav);
  } else {
    initToggles();
    initActiveNav();
  }
})();
