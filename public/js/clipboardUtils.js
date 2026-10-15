// Clipboard Utilities
// Minimal utility for clipboard operations (requires browser API)
window.copyToClipboard = async function(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = button.textContent;
    button.textContent = '✓ Copied!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
    button.textContent = '✗ Failed';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1500);
  }
};
