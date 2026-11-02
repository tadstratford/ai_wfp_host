---
name: clarify
group: core
description: Resolve ambiguity before planning — ask targeted questions for what cannot be derived from data, then store each answer as a typed parameter.
scope: chat
tags: [clarify, intake, question]
tools: [{"name":"list_data","role":"inspect what data exists before asking"},{"name":"get_data","role":"derive values from data instead of asking"},{"name":"show_message","role":"ask the question"},{"name":"set_param","role":"store the answer for the plan"},{"name":"get_param","role":"read a previously answered value"}]
---

## Instructions
1. Derive from data first — only ask for what cannot be computed or looked up.
2. Ask the fewest questions needed; batch related ones.
3. Store each answer as a typed parameter (consume-by-name convention).
4. Never guess a value the user must supply.
