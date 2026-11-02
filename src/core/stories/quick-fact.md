---
name: quick-fact
description: The fast path — a single fact, number, total, or short direct answer over the data.
nouls: [{"id":"quick_fact","instructions":"Does this request ask for a single fact, number, total, or a short direct answer over the loaded data (not a full review, reconciliation, report, or explanation)?"}]
beats: [{"id":"setup","skill":"data-account-check","template":"skim","verify":"none"},{"id":"resolution","skill":"report-authoring","template":"answer","verify":"accurate"}]
---

The fast path: skim the data and answer directly, no report file.
