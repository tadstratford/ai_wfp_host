---
name: report
description: Build a report, dashboard, or downloadable file from the data.
nouls: [{"id":"report","instructions":"Does this request ask ONLY to produce a report, dashboard, or downloadable file from the data as a deliverable, without asking to review, audit, or check the data for correctness?"}]
beats: [{"id":"setup","skill":"data-handling","template":"skim","verify":"none"},{"id":"resolution","skill":"report-authoring","template":"report","verify":"complete-accurate"}]
---

The deliverable story: read the data and produce a self-contained report.
