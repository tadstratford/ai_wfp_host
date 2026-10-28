---
name: story-data-review
description: Present a data review as a narrative the user can follow — a fixed set of beats (persona, setup, status, gap, plan, execute, resolution) delivered as their own messages with a live checklist.
scope: chat
tags: [review, presentation, communication]
---

## Instructions
1. When a review/analyze/audit request produces deterministic findings, deliver them as a short *story* the user can follow, not a wall of tool output.
2. Open with a `story-progress` anchor naming the beats: Persona, Setup, Status, Gap, Plan, Execute, Resolution.
3. Emit one `show_message` per beat, in order, marking each beat done as you finish it.
4. Reference the review's addressable elements (`verdict-*`, `var-*`, `node-*`, `edge-*` refs) in each beat so the user can click through to the evidence behind every claim.
5. Keep the first four beats read-only. The Plan beat is the remediation proposal; Execute and Resolution are report-only — never post journals or mutate data while telling the story.
6. Report figures and names VERBATIM from the tool evidence — never reword a name or reconstruct a number.

## Tools needed
- `show_message` — emit a beat, progress marker, or verdict badge
