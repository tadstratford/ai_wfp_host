// Chat Helpers - session row navigation and URL updates

window.copySessionData = async function(btn) {
  const sessionId = btn.dataset.sessionId;
  if (!sessionId) return;
  try {
    const res = await fetch('/sessions/export/' + sessionId);
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 2000);
  } catch (e) {
    console.error('Failed to copy session data', e);
  }
};

// Session list row click navigation
document.addEventListener('click', function(e) {
  const row = e.target.closest('.session-row');
  if (row && !e.target.closest('a, button')) {
    const href = row.getAttribute('data-href');
    if (href) window.location.href = href;
  }
});

// Chat URL update after HTMX swap.
// A hidden <span id="chat-url-update" data-url="..." data-session-id="..."> signals
// the update is needed. Prefer the server-provided shell URL (data-url); fall back
// to the legacy /sessions form only if data-url is absent.
document.addEventListener('htmx:afterSettle', function() {
  const el = document.getElementById('chat-url-update');
  if (el) {
    const url = el.dataset.url || ('/sessions?session_id=' + el.dataset.sessionId);
    history.replaceState(null, '', url);
    el.remove();
  }
});

// Keep the chat pinned to the latest message whenever #chat-messages re-renders.
// Only auto-scroll when the user is already near the bottom, so reading the
// expanded process details (or older history) isn't interrupted.
function scrollChatToBottom() {
  var msgs = document.getElementById('chat-messages');
  if (!msgs) return;
  var node = msgs.parentElement;
  while (node && node !== document.body) {
    var oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) break;
    node = node.parentElement;
  }
  var scroller = (node && node !== document.body) ? node : (document.scrollingElement || document.documentElement);
  var nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}

document.addEventListener('htmx:afterSwap', function(e) {
  var target = e.detail && e.detail.target;
  var msgs = document.getElementById('chat-messages');
  if (!msgs || !target || !(target === msgs || (target.contains && target.contains(msgs)))) return;
  scrollChatToBottom();
});

// Auto-expand textarea — called from build input
window.autoExpandTextarea = function(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
};

// "Saved prompts" / "Capabilities" panels — append the prompt to the composer
// without overwriting what's already there.
window.appendToComposer = function(el) {
  var input = document.getElementById('build-input');
  if (!input) return;
  var raw = el.getAttribute('data-prompt') || '';
  var text = '';
  try { text = JSON.parse(raw); } catch (e) { text = raw; }
  if (!text) return;
  var val = input.value;
  var last = val.charAt(val.length - 1);
  var sep = (val.length > 0 && last !== ' ' && last !== '\n') ? ' ' : '';
  input.value = val + sep + text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  autoExpandTextarea(input);
  input.focus();
};

// "Data" panel — insert a data item name into the composer at the cursor.
window.insertDataRef = function(name) {
  var input = document.getElementById('build-input');
  if (!input) return;
  var start = (input.selectionStart != null) ? input.selectionStart : input.value.length;
  var end = (input.selectionEnd != null) ? input.selectionEnd : input.value.length;
  var val = input.value;
  input.value = val.slice(0, start) + name + val.slice(end);
  var pos = start + name.length;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  autoExpandTextarea(input);
  input.focus();
};

// "Data" panel — single click inserts the name, double click opens the editor.
(function () {
  var timer = null;
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-data-ref]');
    if (!el) return;
    var name = el.getAttribute('data-name');
    if (!name) return;

    if (timer) {
      // Second click within the window → treat as a double click: open editor.
      clearTimeout(timer);
      timer = null;
      htmx.ajax('GET', '/app/data/edit/' + encodeURIComponent(name), {
        target: '#modal-container',
        swap: 'innerHTML'
      }).then(function () {
        var mc = document.getElementById('modal-container');
        if (mc) mc.classList.remove('hidden');
      });
      return;
    }

    timer = setTimeout(function () {
      timer = null;
      insertDataRef(name);
    }, 250);
  });
})();

// "Make Changes" button — event delegation for dynamically rendered button
document.addEventListener('click', function(e) {
  var btn = e.target.closest('#btn-make-changes');
  if (btn) {
    var el = document.getElementById('build-input');
    if (el) {
      el.focus();
      el.placeholder = 'Describe what to change...';
    }
  }
});

// "Give Feedback" button — focuses input with feedback placeholder
document.addEventListener('click', function(e) {
  var btn = e.target.closest('#btn-give-feedback');
  if (btn) {
    var el = document.getElementById('build-input');
    if (el) {
      el.focus();
      el.placeholder = 'Describe what you\'d like instead...';
    }
  }
});
