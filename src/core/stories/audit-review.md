---
name: audit-review
description: The accountant's arc — review the data, surface findings, and (optionally) deliver a report.
nouls: [{"id":"audit_review","instructions":"Does this request ask to review, audit, analyze, reconcile, check, foot, or tie out the loaded data the way an accountant would, even if it also asks to report those findings?"}]
beats: [{"id":"persona","skills":["story-data-review"],"template":"persona","verify":"none"},{"id":"setup","skills":["data-account-check"],"template":"map","verify":"accurate"},{"id":"status","skills":["data-account-check"],"template":"verdicts","verify":"accurate"},{"id":"gap","skills":["story-data-review"],"template":"findings","verify":"accurate"},{"id":"plan","skills":["story-data-review"],"template":"remediation","verify":"grounded-actionable"},{"id":"execute","skills":["qbo-journaling"],"template":"journal","verify":"balanced","write":true},{"id":"resolution","skills":["report-authoring"],"template":"report","verify":"complete-accurate"}]
---

The accountant's arc: understand the data, judge whether it is correct, pinpoint what must change, and (when requested) deliver a report.
