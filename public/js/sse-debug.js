/**
 * SSE Debugging Event Listeners
 * Based on HTMX SSE Extension documentation
 */

console.log('[SSE Debug] Initializing SSE debugging listeners...');

// Configuration - set to false to disable visual indicator
const SHOW_DEBUG_INDICATOR = true;

// Helper function to log SSE events with nice formatting
function logSSEEvent(eventType, element, detail) {
  const timestamp = new Date().toISOString();
  const elementId = element?.id || element?.className || 'unknown';
  
  console.group(`[SSE ${eventType}] ${timestamp}`);
  console.log('Element:', elementId);
  console.log('Detail:', detail);
  console.log('Full Element:', element);
  console.groupEnd();
}

// Wrap all body event listeners in DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('[SSE Debug] DOM loaded, attaching event listeners to body...');

  // Listen for SSE connection events
  document.body.addEventListener('htmx:sseOpen', function(evt) {
    console.log('[SSE Debug] Connection OPENED!');
    const element = evt.detail?.elt;
    if (element) {
      const sseConnectUrl = element.getAttribute('sse-connect');
      logSSEEvent('Connection Opened', element, {
        url: sseConnectUrl,
        swapEvent: element.getAttribute('sse-swap')
      });
    }
  });

  document.body.addEventListener('htmx:sseError', function(evt) {
    console.error('[SSE Error]', evt.detail);
    logSSEEvent('Connection Error', evt.detail?.elt, {
      error: evt.detail?.error,
      url: evt.detail?.elt?.getAttribute('sse-connect')
    });
  });

  document.body.addEventListener('htmx:sseClose', function(evt) {
    console.log('[SSE Debug] Connection CLOSED');
    logSSEEvent('Connection Closed', evt.detail?.elt, {
      url: evt.detail?.elt?.getAttribute('sse-connect'),
      reason: evt.detail?.reason || 'Unknown'
    });
  });

  // Listen for SSE message events
  document.body.addEventListener('htmx:sseMessage', function(evt) {
    const data = evt.detail?.data;
    const event = evt.detail?.event;
    const lastEventId = evt.detail?.lastEventId;
    
    console.group(`[SSE Message] ${new Date().toISOString()}`);
    console.log('Event Type:', event);
    console.log('Last Event ID:', lastEventId);
    console.log('Data Length:', data ? data.length : 0);
    console.log('Data Preview:', data ? data.substring(0, 100) + '...' : 'No data');
    console.log('Target Element:', evt.detail?.elt?.id || evt.detail?.elt?.className);
    console.groupEnd();
  });

  // Monitor for custom SSE events (like new_message)
  document.body.addEventListener('sse:new_message', function(evt) {
    console.log('[SSE Event] new_message received!', evt);
  });

  document.body.addEventListener('sse:connected', function(evt) {
    console.log('[SSE Event] connected received!', evt);
  });

  document.body.addEventListener('sse:heartbeat', function(evt) {
    console.log('[SSE Event] heartbeat received!', evt);
  });

  // Listen for HTMX swap events
  document.body.addEventListener('htmx:beforeSwap', function(evt) {
    if (evt.detail?.xhr?.responseURL?.includes('sse')) {
      console.log('[SSE Swap] About to swap content for:', evt.detail.elt?.id || evt.detail.elt?.className);
    }
  });

  document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail?.xhr?.responseURL?.includes('sse')) {
      console.log('[SSE Swap] Completed swap for:', evt.detail.elt?.id || evt.detail.elt?.className);
    }
  });

  // Monitor all SSE event sources
  monitorSSEConnections();

  // Create status indicator
  if (SHOW_DEBUG_INDICATOR) {
    createSSEStatusIndicator();
    updateSSEStatus('Ready', '#4ade80');
  }

  console.log('[SSE Debug] All event listeners attached');
});

// Monitor all SSE event sources
function monitorSSEConnections() {
  // Look for elements with sse-connect attribute
  const sseElements = document.querySelectorAll('[sse-connect]');
  console.group('[SSE Debug] Active SSE Elements');
  
  if (sseElements.length === 0) {
    console.log('No SSE elements found with [sse-connect] attribute');
    console.log('Checking body for hx-ext and sse-connect...');
    
    const body = document.body;
    const hxExt = body?.getAttribute('hx-ext');
    const sseConnect = body?.getAttribute('sse-connect');
    console.log('Body hx-ext:', hxExt);
    console.log('Body sse-connect:', sseConnect);
  }
  
  sseElements.forEach((element, index) => {
    const sseConnect = element.getAttribute('sse-connect');
    const sseSwap = element.getAttribute('sse-swap');
    const hxExt = element.getAttribute('hx-ext');
    const elementId = element.id || element.tagName || `element-${index}`;
    
    console.log(`${index + 1}. ${elementId}`);
    console.log(`   - Connect: ${sseConnect}`);
    console.log(`   - Swap Event: ${sseSwap}`);
    console.log(`   - hx-ext: ${hxExt}`);
    console.log(`   - Element:`, element);
  });
  
  console.log(`Total SSE connections: ${sseElements.length}`);
  console.groupEnd();
}

// Add a global function to check SSE status
window.checkSSEStatus = function() {
  console.log('[SSE Debug] Checking SSE Status...');
  monitorSSEConnections();
  
  // Check for HTMX
  if (window.htmx) {
    console.log('[SSE Debug] HTMX is loaded, version:', htmx.version);
    console.log('[SSE Debug] HTMX extensions:', htmx.extensions);
  } else {
    console.log('[SSE Debug] HTMX is NOT loaded!');
  }
};

// Add keyboard shortcut for debugging (Ctrl+Shift+S)
document.addEventListener('keydown', function(evt) {
  if (evt.ctrlKey && evt.shiftKey && evt.key === 'S') {
    evt.preventDefault();
    window.checkSSEStatus();
  }
});

console.log('[SSE Debug] Debugging script loaded. Press Ctrl+Shift+S to check SSE status.');

// Create a visual SSE status indicator
function createSSEStatusIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'sse-status-indicator';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 8px 12px;
    border-radius: 20px;
    font-family: monospace;
    font-size: 11px;
    z-index: 9999;
    max-width: 200px;
    opacity: 0.9;
    cursor: pointer;
    transition: opacity 0.3s ease;
  `;
  
  indicator.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div id="sse-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;"></div>
      <div style="font-size: 10px;">SSE: Waiting</div>
    </div>
  `;
  
  indicator.addEventListener('click', function() {
    window.checkSSEStatus();
  });
  
  document.body.appendChild(indicator);
  return indicator;
}

// Update status indicator
function updateSSEStatus(status, color = '#4ade80') {
  const dot = document.getElementById('sse-dot');
  const indicator = document.getElementById('sse-status-indicator');
  if (dot) {
    dot.style.background = color;
  }
  if (indicator) {
    indicator.querySelector('div > div:nth-child(2)').textContent = 'SSE: ' + status;
  }
}

// Update indicator on SSE events (if body exists)
document.addEventListener('DOMContentLoaded', function() {
  document.body.addEventListener('htmx:sseOpen', () => updateSSEStatus('Connected', '#4ade80'));
  document.body.addEventListener('htmx:sseError', () => updateSSEStatus('Error', '#ef4444'));
  document.body.addEventListener('htmx:sseClose', () => updateSSEStatus('Closed', '#f59e0b'));
  document.body.addEventListener('htmx:sseMessage', () => {
    updateSSEStatus('Message!', '#3b82f6');
    setTimeout(() => updateSSEStatus('Connected', '#4ade80'), 500);
  });
});