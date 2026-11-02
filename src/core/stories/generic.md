---
name: generic
description: The catch-all story — clarify what is needed, then use the available skills to answer.
nouls: [{"id":"generic","instructions":"Does this request fall outside the specific stories (audit-review, quick-fact, report) — a general request that needs clarification or broad assistance?"}]
beats: [{"id":"clarify","skill":"clarify","template":"clarify","verify":"none"},{"id":"resolve","template":"answer","verify":"accurate"}]
---

The fallback story: clarify the need first, then resolve with whatever skills fit.
