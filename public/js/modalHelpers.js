// Modal Helpers - cancel buttons and toast/modal cleanup

// Cancel buttons for workflow modals (event delegation handles dynamically inserted modals)
document.addEventListener('click', function(e) {
  const scheduleCancel = e.target.closest('#cancel-schedule-modal');
  if (scheduleCancel) {
    const modal = scheduleCancel.closest('.fixed');
    if (modal) modal.remove();
  }
  const runCancel = e.target.closest('#cancel-run-modal');
  if (runCancel) {
    const modal = runCancel.closest('.fixed');
    if (modal) modal.remove();
  }
  const newWorkspaceCancel = e.target.closest('#cancel-new-workspace-modal');
  if (newWorkspaceCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // New Workflow modal — cancel button or backdrop click
  var newWfCancel = e.target.closest('#cancel-new-workflow-modal');
  if (newWfCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'new-workflow-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // GL edit modal — cancel button or backdrop click
  var glEditCancel = e.target.closest('#cancel-gl-edit-modal');
  if (glEditCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'gl-edit-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // Workspace chat modal (New/Modify Workspace) — cancel button or backdrop click
  var wsChatCancel = e.target.closest('#cancel-workspace-chat-modal');
  if (wsChatCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'workspace-chat-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // Edit data modal — cancel button or backdrop click
  var editDataCancel = e.target.closest('#cancel-edit-data-modal') || e.target.closest('#cancel-edit-data-modal-btn');
  if (editDataCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'edit-data-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // Contact modal — close button, cancel button, or backdrop click
  var closeContact = e.target.closest('#close-contact-modal');
  if (closeContact) {
    var cm = document.getElementById('contact-modal');
    if (cm) cm.remove();
  }
  // Share modal — cancel button or backdrop click
  var shareCancel = e.target.closest('#share-modal-cancel');
  if (shareCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'share-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // Feedback modal — cancel button or backdrop click
  var feedbackCancel = e.target.closest('#cancel-feedback-modal');
  if (feedbackCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'feedback-modal-backdrop') {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  // Knowledge pack modal — cancel button or backdrop click
  var kbCancel = e.target.closest('#cancel-kb-new');
  if (kbCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }
  if (e.target.id === 'kb-new-modal') {
    // Click on backdrop (the fixed overlay itself)
    if (e.target === document.getElementById('kb-new-modal')) {
      var mc = document.getElementById('modal-container');
      if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
    }
  }

  // Model picker modal — cancel button
  var modelCancel = e.target.closest('#cancel-model-picker');
  if (modelCancel) {
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
  }

  // Key form panel inside model picker — close the panel without closing the modal
  var keyCancel = e.target.closest('#cancel-key-form');
  if (keyCancel) {
    var panel = document.getElementById('key-panel');
    if (panel) panel.innerHTML = '';
  }

  // Generic: any cancel/close button inside #modal-container clears it. Covers
  // the workspace lifecycle modals (Open/New/Delete/Save As/Disk) rendered by
  // ModalShell, whose buttons use id="cancel-<modal-id>" / "...-2".
  var genericCancel = e.target.closest('[id^="cancel-"]');
  if (genericCancel && genericCancel.closest('#modal-container')) {
    var mcGen = document.getElementById('modal-container');
    if (mcGen) { mcGen.innerHTML = ''; mcGen.classList.add('hidden'); }
  }

  // Generic backdrop: click on a ModalShell overlay (direct fixed child of
  // #modal-container) outside the card closes it.
  var mcEl = document.getElementById('modal-container');
  if (mcEl && e.target.parentElement === mcEl && e.target.classList.contains('fixed')) {
    mcEl.innerHTML = '';
    mcEl.classList.add('hidden');
  }
});

// Schedule success — close the schedule modal and auto-dismiss the toast.
// A hidden <span id="schedule-success-trigger"> in the response signals this.
document.addEventListener('htmx:afterSettle', function() {
  const trigger = document.getElementById('schedule-success-trigger');
  if (trigger) {
    trigger.remove();
    const modal = document.getElementById('schedule-workflow-modal');
    if (modal) modal.remove();
    setTimeout(function() {
      const toast = document.getElementById('success-toast');
      if (toast) toast.remove();
    }, 5000);
  }

  // Share success — close modal after brief delay so user sees confirmation
  const shareTrigger = document.getElementById('share-success-trigger');
  if (shareTrigger) {
    shareTrigger.remove();
    setTimeout(function() {
      var mc = document.getElementById('modal-container');
      if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
    }, 2500);
  }

  // Workspace settings saved — close the modal (the list refreshes via OOB swap)
  const settingsTrigger = document.getElementById('settings-success-trigger');
  if (settingsTrigger) {
    settingsTrigger.remove();
    var mcSettings = document.getElementById('modal-container');
    if (mcSettings) { mcSettings.innerHTML = ''; mcSettings.classList.add('hidden'); }
  }

  // Workspace details (name + description) saved — close the modal
  const detailsTrigger = document.getElementById('details-success-trigger');
  if (detailsTrigger) {
    detailsTrigger.remove();
    var mcDetails = document.getElementById('modal-container');
    if (mcDetails) { mcDetails.innerHTML = ''; mcDetails.classList.add('hidden'); }
  }

  // Access — add user saved; close the modal (the grid refreshes via OOB swap)
  const accessTrigger = document.getElementById('access-save-trigger');
  if (accessTrigger) {
    accessTrigger.remove();
    var mcAccess = document.getElementById('modal-container');
    if (mcAccess) { mcAccess.innerHTML = ''; mcAccess.classList.add('hidden'); }
  }

  // Feedback success — close modal, show toast
  const feedbackTrigger = document.getElementById('feedback-success-trigger');
  if (feedbackTrigger) {
    feedbackTrigger.remove();
    var mc = document.getElementById('modal-container');
    if (mc) { mc.innerHTML = ''; mc.classList.add('hidden'); }
    setTimeout(function() {
      var toast = document.getElementById('feedback-toast');
      if (toast) toast.remove();
    }, 5000);
  }
});
