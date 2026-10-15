// Manual Journal Entry — client behavior for the Accounting > Inputs form.
//
// Conventions (docs/CONVENTIONS.md): client-side JS lives here, not inline in
// JSX. Rows are cloned with the DOM API; no HTML is built from strings.
//
// Server-side validation in glWrite.post is the gate; this is UX sugar — a live
// debit/credit balance check that drives the totals and the submit button.

function jeSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function jeRecalc() {
  var debit = 0;
  var credit = 0;
  document.querySelectorAll(".je-debit").forEach(function (i) {
    var v = parseFloat(i.value);
    if (!isNaN(v)) debit += v;
  });
  document.querySelectorAll(".je-credit").forEach(function (i) {
    var v = parseFloat(i.value);
    if (!isNaN(v)) credit += v;
  });
  // Work in integer cents for the comparison so float dust never blocks a post.
  var diffCents = Math.round(debit * 100) - Math.round(credit * 100);

  jeSetText("je-total-debit", debit.toFixed(2));
  jeSetText("je-total-credit", credit.toFixed(2));

  var diffEl = document.getElementById("je-diff");
  if (diffEl) {
    diffEl.textContent = (diffCents / 100).toFixed(2);
    diffEl.className =
      diffCents === 0
        ? "text-green-600 dark:text-green-400 font-semibold"
        : "text-red-600 dark:text-red-400 font-semibold";
  }

  var submit = document.getElementById("je-submit");
  if (submit) {
    var ok = diffCents === 0 && debit > 0;
    submit.disabled = !ok;
    submit.classList.toggle("opacity-50", !ok);
    submit.classList.toggle("cursor-not-allowed", !ok);
  }
}

function jeAddLine() {
  var tbody = document.getElementById("je-lines");
  if (!tbody) return;
  var rows = tbody.querySelectorAll("tr.je-line");
  if (!rows.length) return;
  var clone = rows[rows.length - 1].cloneNode(true);
  clone.querySelectorAll("input").forEach(function (i) {
    i.value = "";
  });
  tbody.appendChild(clone);
  var first = clone.querySelector("input");
  if (first) first.focus();
  jeRecalc();
}

function jeRemoveLine(btn) {
  var tbody = document.getElementById("je-lines");
  if (!tbody) return;
  var rows = tbody.querySelectorAll("tr.je-line");
  var tr = btn.closest("tr");
  if (!tr) return;
  if (rows.length <= 2) {
    // Keep at least two lines — just clear this one.
    tr.querySelectorAll("input").forEach(function (i) {
      i.value = "";
    });
  } else {
    tr.parentNode.removeChild(tr);
  }
  jeRecalc();
}

// Serialize the line rows into the hidden `lines_json` field just before the
// form posts. Sending one JSON blob (instead of parallel line_*[] arrays)
// avoids empty-value drops that would misalign the columns.
function jeSerialize() {
  var tbody = document.getElementById("je-lines");
  var hidden = document.getElementById("je-lines-json");
  if (!tbody || !hidden) return;
  var lines = [];
  tbody.querySelectorAll("tr.je-line").forEach(function (tr) {
    var acct = tr.querySelector(".je-account");
    var debit = tr.querySelector(".je-debit");
    var credit = tr.querySelector(".je-credit");
    var memo = tr.querySelector(".je-memo");
    var line = {
      account: acct ? acct.value : "",
      debit: debit ? debit.value : "",
      credit: credit ? credit.value : "",
      memo: memo ? memo.value : "",
    };
    // One key per dimension slot (data-dim = "d1".."d4"), if any are present.
    tr.querySelectorAll(".je-dim").forEach(function (d) {
      var key = d.getAttribute("data-dim");
      if (key) line[key] = d.value;
    });
    lines.push(line);
  });
  hidden.value = JSON.stringify(lines);
}

// After a successful post, clear the line inputs (keep entity/date/header) so
// the user can immediately enter the next journal.
function jeOnPosted() {
  document.querySelectorAll("#je-lines input").forEach(function (i) {
    i.value = "";
  });
  jeRecalc();
}

// Initialize totals/submit state whenever the Inputs view is swapped in.
document.addEventListener("htmx:afterSettle", function () {
  if (document.getElementById("je-lines")) jeRecalc();
});
