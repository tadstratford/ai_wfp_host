(function () {
  "use strict";

  var activePopover = null;
  var popoverEl = null;
  var recognition = null;
  var isRecording = false;
  var currentVoiceBtn = null;
  var synth = window.speechSynthesis;
  var currentlySpeaking = null;
  var stylesInjected = false;

  // ── Dark mode style injection ────────────────────────────────────────────────

  function ensurePopoverStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement("style");
    style.id = "composer-popover-styles";
    style.textContent =
      ".composer-popover{" +
      "background:#fff;color:#111827;border:1px solid #e5e7eb;" +
      "box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -4px rgba(0,0,0,0.1)" +
      "}" +
      ".dark .composer-popover{" +
      "background:#1e293b;color:#f1f5f9;border-color:#374151;" +
      "box-shadow:0 10px 15px -3px rgba(0,0,0,0.4),0 4px 6px -4px rgba(0,0,0,0.3)" +
      "}" +
      ".composer-popover .model-option:hover,.composer-popover .mode-option:hover{" +
      "background:#f3f4f6" +
      "}" +
      ".dark .composer-popover .model-option:hover,.dark .composer-popover .mode-option:hover{" +
      "background:#334155" +
      "}" +
      ".composer-popover .model-group{border-bottom:1px solid #e5e7eb}" +
      ".dark .composer-popover .model-group{border-bottom-color:#374151}" +
      ".composer-popover .model-group:last-child{border-bottom:none}" +
      ".composer-popover .provider-header{font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af}" +
      ".dark .composer-popover .provider-header{color:#94a3b8}" +
      ".composer-popover .model-name{color:#111827}" +
      ".dark .composer-popover .model-name{color:#f1f5f9}" +
      ".composer-popover .mode-title{color:#111827}" +
      ".dark .composer-popover .mode-title{color:#f1f5f9}" +
      ".composer-popover .mode-desc{color:#9ca3af}" +
      ".dark .composer-popover .mode-desc{color:#94a3b8}" +
      ".composer-popover .check-icon{color:#3b82f6}" +
      ".composer-popover .muted-icon{color:#9ca3af}" +
      ".dark .composer-popover .muted-icon{color:#94a3b8}" +
      ".composer-popover .menu-item{padding:6px 12px;font-size:13px}" +
      ".composer-popover .menu-item-description{font-size:11px}" +
      ".composer-popover .menu-item-icon{margin-right:8px}" +
      ".composer-popover .loading-text{color:#9ca3af}" +
      ".dark .composer-popover .loading-text{color:#94a3b8}";
    document.head.appendChild(style);
  }

  // ── Popover helper ──────────────────────────────────────────────────────────

  function openPopover(trigger, contentHtml, opts) {
    opts = opts || {};
    ensurePopoverStyles();
    closePopover();
    activePopover = trigger;

    var popover = document.createElement("div");
    popover.className = "composer-popover";
    popover.style.cssText =
      "position:fixed;z-index:260;width:288px;border-radius:8px;font-size:13px;line-height:1.4;overflow-y:auto;padding:4px 0";
    popover.innerHTML = contentHtml;

    document.body.appendChild(popover);
    popoverEl = popover;

    positionPopover(trigger, popover, opts);

    if (opts.onAfterOpen) opts.onAfterOpen(popover);

    requestAnimationFrame(function () {
      document.addEventListener("click", handleOutsideClick, true);
    });
  }

  function closePopover() {
    if (popoverEl && popoverEl.parentNode) {
      popoverEl.parentNode.removeChild(popoverEl);
    }
    popoverEl = null;
    activePopover = null;
    document.removeEventListener("click", handleOutsideClick, true);
  }

  function handleOutsideClick(e) {
    if (!popoverEl) return;
    if (popoverEl.contains(e.target)) return;
    if (activePopover && activePopover.contains(e.target)) return;
    closePopover();
  }

  function positionPopover(trigger, popover, opts) {
    var rect = trigger.getBoundingClientRect();
    var align = opts.align || "end";

    if (align === "end") {
      popover.style.left = Math.max(8, rect.right - popover.offsetWidth) + "px";
    } else {
      popover.style.left = Math.max(8, rect.left) + "px";
    }

    var spaceAbove = rect.top;
    var spaceBelow = window.innerHeight - rect.bottom;

    if (spaceAbove > popover.offsetHeight + 10 || spaceAbove > spaceBelow) {
      popover.style.bottom = (window.innerHeight - rect.top + 6) + "px";
    } else {
      popover.style.top = (rect.bottom + 6) + "px";
    }

    var maxH = Math.min(500, window.innerHeight - 100);
    popover.style.maxHeight = maxH + "px";
    popover.style.overflowY = "auto";
  }

  // ── Model Picker ────────────────────────────────────────────────────────────

  var modelCache = null;

  function openModelPicker(trigger, providerInputId, modelInputId) {
    providerInputId = providerInputId || "build-model-provider";
    modelInputId = modelInputId || "build-model-name";
    trigger._modelContext = { providerInputId: providerInputId, modelInputId: modelInputId };

    if (modelCache) {
      renderModelPopover(trigger, modelCache);
      return;
    }

    openPopover(
      trigger,
      '<div class="loading-text" style="padding:8px 12px;font-size:12px">Loading models...</div>',
      { align: "end" }
    );

    fetch("/app/api/models")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        modelCache = data;
        renderModelPopover(trigger, data);
      })
      .catch(function () {
        if (popoverEl) {
          popoverEl.innerHTML =
            '<div class="px-3 py-2 text-red-500 text-xs">Failed to load models</div>';
        }
      });
  }

  function renderModelPopover(trigger, data) {
    var ctx = (trigger && trigger._modelContext) || {};
    var providerId = ctx.providerInputId || "build-model-provider";
    var modelId = ctx.modelInputId || "build-model-name";
    var currentProvider =
      document.getElementById(providerId)?.value || "";
    var currentModel =
      document.getElementById(modelId)?.value || "";

    var html = "";

    var providers = data.providers || {};
    var providerKeys = Object.keys(providers);

    for (var i = 0; i < providerKeys.length; i++) {
      var key = providerKeys[i];
      var p = providers[key];
      var isActive = currentProvider === key;

      html +=
        '<div class="model-group">';
      html +=
        '<div class="provider-header" style="padding:6px 8px">' +
        escapeHtml(p.name) +
        "</div>";

      var models = p.models || [];
      for (var j = 0; j < models.length; j++) {
        var m = models[j];
        var isSelected = isActive && currentModel === m.id;
        html +=
          '<button type="button" class="model-option" style="display:flex;width:100%;align-items:center;gap:12px;padding:6px 8px 6px 20px;text-align:left;border:none;background:none;cursor:pointer"' +
          ' data-provider="' + escapeAttr(key) + '"' +
          ' data-model="' + escapeAttr(m.id) + '"' +
          ">" +
          '<span class="model-name" style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(m.name) +
          "</span>" +
          (isSelected
            ? '<svg class="check-icon" style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>'
            : "") +
          "</button>";
      }
      html += "</div>";
    }

    if (popoverEl) {
      popoverEl.innerHTML = html;
      positionPopover(trigger, popoverEl, { align: "end" });
    } else {
      openPopover(trigger, html, {
        align: "end",
        onAfterOpen: function () {
          // scope is already set
        },
      });
    }
  }

  function selectModel(provider, model) {
    var ctx = (activePopover && activePopover._modelContext) || {};
    var providerId = ctx.providerInputId || "build-model-provider";
    var modelId = ctx.modelInputId || "build-model-name";

    var providerEl = document.getElementById(providerId);
    var modelEl = document.getElementById(modelId);
    if (providerEl) providerEl.value = provider;
    if (modelEl) modelEl.value = model;

    // Update the label on the trigger button
    if (activePopover) {
      var label = activePopover.querySelector(".composer-model-label");
      if (!label) {
        var toolbar = activePopover.closest(".agent-composer-toolbar");
        if (toolbar) label = toolbar.querySelector(".composer-model-label");
      }
      if (label) {
        var shortName = model;
        if (provider === "anthropic") {
          if (model.includes("sonnet")) shortName = "Sonnet";
          else if (model.includes("opus")) shortName = "Opus";
          else if (model.includes("haiku")) shortName = "Haiku";
        }
        if (shortName.length > 14) shortName = shortName.slice(0, 12) + "...";
        label.textContent = shortName;
      }
    }

    fetch("/app/api/model-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ provider: provider, model: model }),
    }).catch(function () {});

    closePopover();
  }

  // ── Mode Picker ─────────────────────────────────────────────────────────────

  function openModePicker(trigger, modeInputId, labelSelector) {
    modeInputId = modeInputId || "build-mode";
    labelSelector = labelSelector || ".composer-mode-label";
    var currentMode = document.getElementById(modeInputId)?.value || "build";

    // Store context for selectMode
    trigger._modeContext = { modeInputId: modeInputId, labelSelector: labelSelector };

    var html =
      '<button type="button" class="mode-option" style="display:flex;width:100%;align-items:center;gap:12px;padding:8px 12px;text-align:left;border:none;background:none;cursor:pointer" data-mode="build">' +
      '<svg class="menu-item-icon muted-icon" style="width:16px;height:16px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>' +
      '<div style="flex:1;min-width:0">' +
      '<span class="mode-title" style="font-weight:500;font-size:13px">Act</span>' +
      '<p class="mode-desc" style="margin-top:2px;font-size:11px">Use tools and make approved changes</p>' +
      "</div>" +
      (currentMode === "build"
        ? '<svg class="check-icon" style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>'
        : "") +
      "</button>" +
      '<button type="button" class="mode-option" style="display:flex;width:100%;align-items:center;gap:12px;padding:8px 12px;text-align:left;border:none;background:none;cursor:pointer" data-mode="plan">' +
      '<svg class="menu-item-icon muted-icon" style="width:16px;height:16px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>' +
      '<div style="flex:1;min-width:0">' +
      '<span class="mode-title" style="font-weight:500;font-size:13px">Plan</span>' +
      '<p class="mode-desc" style="margin-top:2px;font-size:11px">Read-only research and approval first</p>' +
      "</div>" +
      (currentMode === "plan"
        ? '<svg class="check-icon" style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>'
        : "") +
      "</button>";

    openPopover(trigger, html, { align: "end" });
  }

  function selectMode(mode) {
    var ctx = (activePopover && activePopover._modeContext) || {};
    var modeId = ctx.modeInputId || "build-mode";
    var selector = ctx.labelSelector || ".composer-mode-label";

    var modeEl = document.getElementById(modeId);
    if (modeEl) modeEl.value = mode;

    // Update the nearest visible label element
    if (activePopover) {
      var label = activePopover.querySelector("span.composer-mode-label");
      if (!label) {
        var toolbar = activePopover.closest(".agent-composer-toolbar");
        if (toolbar) label = toolbar.querySelector("span.composer-mode-label");
      }
      if (!label) label = document.querySelector(selector);
      if (label) label.textContent = mode === "plan" ? "Plan" : "Act";
    }

    fetch("/app/api/chat-mode", {
      method: "POST",
      body: new URLSearchParams({ mode: mode }),
    }).catch(function () {});

    closePopover();
  }

  // ── Voice Dictation (Speech-to-Text) ────────────────────────────────────────

  function openVoiceDictation(trigger) {
    var SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showVoiceNotice(
        "Voice dictation is not supported in this browser. Try Chrome or Edge."
      );
      return;
    }

    if (isRecording) {
      stopDictation();
      return;
    }

    startDictation(trigger);
  }

  function startDictation(trigger) {
    var SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    currentVoiceBtn = trigger;
    var root = trigger ? trigger.closest(".agent-composer-root") : null;
    var textarea = root ? root.querySelector("textarea") : document.getElementById("build-input");
    var origPlaceholder = textarea ? textarea.placeholder : "";

    recognition.onresult = function (event) {
      var interim = "";
      var final = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (textarea) {
        var current = textarea.value;
        if (final) {
          textarea.value = current + (current ? " " : "") + final;
          textarea.placeholder = origPlaceholder;
        }
        if (interim) {
          textarea.placeholder = "Listening: " + interim + "...";
        }
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };

    recognition.onerror = function (event) {
      stopDictation();
      if (event.error === "not-allowed") {
        showVoiceNotice("Microphone access denied. Check your browser settings.");
      } else if (event.error !== "aborted") {
        showVoiceNotice("Voice error: " + event.error);
      }
      if (textarea) {
        textarea.placeholder = origPlaceholder;
      }
    };

    recognition.onend = function () {
      setVoiceRecordingState(false);
      if (textarea) {
        textarea.placeholder = origPlaceholder;
      }
    };

    try {
      recognition.start();
      isRecording = true;
      setVoiceRecordingState(true);
    } catch (e) {
      console.error("Speech recognition start failed:", e);
    }
  }

  function stopDictation() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {}
      recognition = null;
    }
    isRecording = false;
    setVoiceRecordingState(false);
  }

  function setVoiceRecordingState(recording) {
    var btn = currentVoiceBtn || document.getElementById("composer-voice");
    if (!btn) return;

    if (recording) {
      btn.style.color = "#00B5FF";
      btn.style.backgroundColor = "rgba(0,181,255,0.1)";
      btn.innerHTML =
        '<svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
      btn.setAttribute("aria-label", "Stop recording");
    } else {
      btn.style.color = "";
      btn.style.backgroundColor = "";
      btn.innerHTML =
        '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>';
      btn.setAttribute("aria-label", "Dictate");
    }
  }

  function showVoiceNotice(message) {
    var existing = document.querySelector(".composer-voice-notice");
    if (existing) existing.remove();

    var notice = document.createElement("div");
    notice.className =
      "composer-voice-notice mx-2 mt-1 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-500";
    notice.setAttribute("role", "alert");
    notice.innerHTML =
      '<span class="flex-1">' +
      escapeHtml(message) +
      "</span>" +
      '<button type="button" class="shrink-0 hover:text-red-700" onclick="this.parentNode.remove()">' +
      '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
      "</button>";

    var area = document.querySelector(".agent-composer-area");
    if (area) {
      var root = area.querySelector(".agent-composer-root");
      if (root) {
        root.parentNode.insertBefore(notice, root);
      } else {
        area.insertBefore(notice, area.firstChild);
      }
    }

    setTimeout(function () {
      if (notice.parentNode) notice.remove();
    }, 5000);
  }

  // ── Text-to-Speech (TTS) ────────────────────────────────────────────────────

  function initTTS() {
    var chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;

    injectSpeakerButtons(chatMessages);

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType === 1) {
            injectSpeakerButtons(node);
          }
        }
      }
    });

    observer.observe(chatMessages, { childList: true, subtree: true });
  }

  function injectSpeakerButtons(container) {
    if (!container || !container.querySelectorAll) return;

    var messages = container.querySelectorAll(
      ".ds-card, [data-role='assistant'], .message-assistant"
    );
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.querySelector(".composer-speak-btn")) continue;

      var prose = msg.querySelector(".prose, [data-content], .message-content");
      if (!prose) continue;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "composer-speak-btn inline-flex items-center gap-1 mt-2 px-2 py-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors";
      btn.innerHTML =
        '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>' +
        '<span class="composer-speak-label">Listen</span>';

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleSpeak(prose, btn);
      });

      msg.appendChild(btn);
    }
  }

  function toggleSpeak(element, btn) {
    if (currentlySpeaking) {
      synth.cancel();
      if (currentlySpeaking.btn) {
        updateSpeakButton(currentlySpeaking.btn, false);
      }
      currentlySpeaking = null;
      return;
    }

    var text = element.textContent || element.innerText || "";
    text = text.replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) return;

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = function () {
      updateSpeakButton(btn, false);
      currentlySpeaking = null;
    };

    utterance.onerror = function () {
      updateSpeakButton(btn, false);
      currentlySpeaking = null;
    };

    synth.speak(utterance);
    currentlySpeaking = { utterance: utterance, btn: btn };
    updateSpeakButton(btn, true);
  }

  function updateSpeakButton(btn, speaking) {
    if (!btn) return;
    var label = btn.querySelector(".composer-speak-label");
    var icon = btn.querySelector("svg");

    if (speaking) {
      btn.style.color = "#3b82f6";
      if (icon) {
        icon.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>';
      }
      if (label) label.textContent = "Stop";
    } else {
      btn.style.color = "";
      if (icon) {
        icon.innerHTML =
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>';
      }
      if (label) label.textContent = "Listen";
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Event delegation for toolbar buttons ────────────────────────────────────

  document.addEventListener("click", function (e) {
    var target = e.target;

    // Voice button (chat page)
    var voiceBtn = target.closest("#composer-voice");
    if (voiceBtn) {
      e.preventDefault();
      openVoiceDictation(voiceBtn);
      return;
    }

    // Voice button (overview page)
    var ovVoiceBtn = target.closest("#ov-composer-voice");
    if (ovVoiceBtn) {
      e.preventDefault();
      openVoiceDictation(ovVoiceBtn);
      return;
    }

  });

  // Keyboard shortcut: Ctrl+Shift+M to toggle voice
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "M") {
      e.preventDefault();
      var voiceBtn = document.getElementById("composer-voice") || document.getElementById("ov-composer-voice");
      if (voiceBtn) openVoiceDictation(voiceBtn);
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTTS);
  } else {
    initTTS();
  }
})();
