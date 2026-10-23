# System of Record — Overview

> The 100,000-foot view of WorkflowPeople's system-of-record vision, plus the
> five areas in lay terms. See [`wfp-nodes.md`](wfp-nodes.md) for the document
> shape and [`plan.md`](plan.md) for the implementation plan.

## The 100,000-foot view

Every client engagement becomes a single, self-contained, human-readable
**Client File** — the `.wfp` document. It holds the client's books, the
procedures that touch them, and the *proof* of everything that happened to
them: who did what, with which tool and version, when, and why. One file is the
source of truth for one client; the files roll up into one firm-wide backbone.

Everything splits into two planes:

- **The Record** — inside the `.wfp`. Portable, encrypted, owned; travels with
  the file and proves itself.
- **The Shell** — the application database. Administration: who can log in, who
  may open which file, what teams and engagements exist.

## The three principles

1. **Every figure is attributable** — automatically, with the "why" attached at
   each checkpoint.
2. **Nothing is silently rewritten** — all changes append to a hash-chained
   ledger; checkpoints let you reopen any past state.
3. **Ownership is real** — the firm holds the key (never stored by us), the file
   is portable and human-readable, and it carries its own history.

## The "Time Machine"

The change ledger + checkpoints are exposed to users as the **Time Machine** — a
clear mental model ("go back to any point in time") rather than an abstract
"provenance dimension." Internally the node is still called `provenance`; "Time
Machine" is the product framing and the UI that lets you browse history, reopen
a past state, and compare two points.

## The five areas, in lay terms

| Area | Lay meaning | What it does here |
|---|---|---|
| **UI** | "What you see and touch" | The screens: the Time Machine (history browser, diffs, reopen/compare), and later a firm control tower. See [`ui.md`](ui.md). |
| **Data** | "What's stored and remembered" | The `.wfp` file itself — books, procedures, the change ledger, the privacy mask — plus the app database that holds admin records. Most of the work lands here. |
| **Harness** | "What runs the work" | The engine that executes workflows and chat and calls the tools/AI. Its job: automatically stamp every change with who/what/when. |
| **Capabilities** | "What it can do" | The built-in skills — QuickBooks, email, planning, and so on. Each declares its own name + version so the harness can stamp "who produced this number." |
| **Identity & Access** | "Who you are, and what you're allowed to see" | Users, teams, engagements, and sharing. A fifth concern that doesn't fit the other four. Deferred on enforcement this phase. |

## Deliberately out of scope this phase

- **No blockchain** — tamper-evidence comes from an internal hash-chained
  ledger, which is simpler, private, and defensible.
- **No RBAC** — access stays on the existing per-file/per-email grants.
  Team-based grants and segregation-of-duties enforcement wait for a later
  phase.
- **No git** — we borrow git's *ideas* (content-addressing, diffs, checkpoints)
  but build a purpose-built store, because accounting needs append-only history
  with conflicts surfaced to a human, never auto-merged.
- **No search index** — deferred. Cross-client search is a firm-layer concern
  that needs the aggregation + identity backbone first, and any index over
  encrypted data must be privacy-preserving (a write-time blind index), not a
  naive full-text table.
