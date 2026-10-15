/**
 * Sortable step list for workflow node reordering.
 * Initializes SortableJS on #sortable-steps and POSTs new order via HTMX.
 */
(function () {
  function initSortable() {
    var el = document.getElementById('sortable-steps');
    if (!el || !window.Sortable) return;
    if (el._sortableInitialized) return;
    el._sortableInitialized = true;

    Sortable.create(el, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'bg-blue-100',
      onEnd: function () {
        var workflowId = el.getAttribute('data-workflow-id');
        if (!workflowId) return;

        // Collect node IDs from pinned start + draggable middle + pinned end
        var startEls = document.querySelectorAll('.pinned-start');
        var endEls = document.querySelectorAll('.pinned-end');
        var middleEls = el.querySelectorAll('.sortable-step');

        var ids = [];
        startEls.forEach(function (e) { ids.push(e.getAttribute('data-node-id')); });
        middleEls.forEach(function (e) { ids.push(e.getAttribute('data-node-id')); });
        endEls.forEach(function (e) { ids.push(e.getAttribute('data-node-id')); });

        console.log('[sortable] Reorder POST:', workflowId, ids);

        // Build a hidden form and submit via HTMX
        var form = document.createElement('form');
        form.style.display = 'none';
        var input1 = document.createElement('input');
        input1.name = 'workflow_id';
        input1.value = workflowId;
        var input2 = document.createElement('input');
        input2.name = 'node_ids';
        input2.value = ids.join(',');
        form.appendChild(input1);
        form.appendChild(input2);
        document.body.appendChild(form);

        htmx.ajax('POST', '/workflow/reorder', {
          source: form,
          target: '#right-panel',
          swap: 'innerHTML'
        }).then(function() {
          form.remove();
        });
      }
    });
  }

  // Initialize on page load and after HTMX swaps
  document.addEventListener('DOMContentLoaded', function () {
    initSortable();
    document.body.addEventListener('htmx:afterSettle', initSortable);
  });
})();
