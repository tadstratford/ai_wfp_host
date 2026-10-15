// Card-row actions menu (the ⋯ button on client cards).
// Used by /app/workspaces and /design-system. Pattern: event delegation,
// works for any card inserted later (HTMX swap, OOB, etc.). No keyboard
// arrow navigation — only click-outside + Escape close.

(function () {
  function closeAll() {
    document.querySelectorAll('[data-card-menu], [data-card-submenu]').forEach(function (m) {
      m.classList.add('hidden');
    });
    document.querySelectorAll('[data-card-menu-btn], [data-submenu-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  // Toggle a single menu from its ⋯ button.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-card-menu-btn]');
    if (!btn) return;
    var id = btn.getAttribute('data-card-menu-btn');
    var menu = id && document.getElementById(id);
    if (!menu) return;
    var wasOpen = !menu.classList.contains('hidden');
    closeAll();
    if (!wasOpen) {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
  });

  // Toggle a nested submenu from its "Email ▸" trigger (without closing the card menu).
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-submenu-toggle]');
    if (!toggle) return;
    var sub = toggle.parentElement && toggle.parentElement.querySelector('[data-card-submenu]');
    if (!sub) return;
    var wasOpen = !sub.classList.contains('hidden');
    document.querySelectorAll('[data-card-submenu]').forEach(function (s) {
      s.classList.add('hidden');
    });
    document.querySelectorAll('[data-submenu-toggle]').forEach(function (t) {
      t.setAttribute('aria-expanded', 'false');
    });
    if (!wasOpen) {
      sub.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  // Copy-email items copy the address to the clipboard (label gives feedback).
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy-email]');
    if (!el) return;
    var text = el.getAttribute('data-copy-email');
    if (!text) return;
    var label = el.querySelector('[data-copy-label]');
    if (!label) return;
    var original = label.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        label.textContent = 'Copied!';
        setTimeout(function () { label.textContent = original; }, 1500);
      }).catch(function () {
        label.textContent = 'Copy failed';
        setTimeout(function () { label.textContent = original; }, 1500);
      });
    }
  });

  // Click on a menu item closes it (HTMX picks up the request from the
  // item's own hx-* attrs; for plain links like Download it just closes).
  document.addEventListener('click', function (e) {
    var item = e.target.closest('[data-card-menu] [data-card-menu-item]');
    if (item) closeAll();
  });

  // Click outside any menu or button → close them all.
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-card-menu]')) return;
    if (e.target.closest('[data-card-menu-btn]')) return;
    closeAll();
  });

  // Escape closes any open menu.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });
})();
