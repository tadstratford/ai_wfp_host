/**
 * Layout Scripts
 * Client-side JavaScript for layout functionality
 */

// Database ID header injection for multi-tenant support
document.addEventListener("htmx:configRequest", function (evt) {
  const dbId = localStorage.getItem("user_db_id");
  if (dbId) {
    evt.detail.headers["x-database-id"] = dbId;
    // Sync cookie for F5 refresh support
    if (document.cookie.indexOf("user_db_id=" + dbId) === -1) {
      document.cookie = "user_db_id=" + dbId + "; path=/; max-age=31536000";
    }
  }
});

// Clear localStorage on logout
document.addEventListener("htmx:beforeRequest", function (evt) {
  if (evt.detail.path === "/auth/logout") {
    localStorage.clear();
  }
});
// Utility to safely copy text to clipboard
window.copyToClipboard = (text, btn) => {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
};

// Utility to copy session data from hidden script tag
window.copySessionData = (btn) => {
  const dataEl = document.getElementById("session-data-json");
  if (dataEl) {
    window.copyToClipboard(dataEl.textContent, btn);
  } else {
    console.error("Session data not found");
  }
};
