---
knowledge_name: typed-envelope
description: Typed envelope data contract — _meta.type and data wrapping conventions
relevant_agents: [build-workflow, modify-workflow]
---

## Typed Envelope — The Data Contract

Every value flowing through workflows uses a typed envelope: `{ _meta: { type, ... }, data: value }`

`api.getParameter(name)` returns the **raw data** (unwrapped — the `.data` value, not the envelope).
`api.getParameterMeta(name)` returns the `_meta` object.
`api.setParameter(name, value)` accepts a raw value (auto-wrapped into the right envelope) OR a full envelope. Pass a full envelope when you want to set metadata like `columns` or `rowCount`.

### _meta.type values

| type | data shape | when to use |
|------|-----------|-------------|
| `string` | `"text"` | Simple string values |
| `number` | `42` | Numeric values |
| `boolean` | `true/false` | Flags and switches |
| `csv` | `[{...}, ...]` | Tabular data from CSV — include `rowCount` and `columns` |
| `json_array` | `[{...}, ...]` | Array of objects — include `rowCount` and `columns` |
| `json_object` | `{...}` | Single object |
| `text` | `"long text..."` | Multi-line text, HTML documents — include `length` |

### Examples

```js
// Reading — getParameter returns raw values
const rows = api.getParameter("data");     // → [{col: "val"}, ...]
const meta = api.getParameterMeta("data"); // → { type: "csv", rowCount: 18, columns: ["col"] }

// Writing — setParameter accepts raw values (auto-wrapped) or full envelopes
api.setParameter("result", rows);                          // auto-wrapped from array
api.setParameter("total", 42.50);                          // auto-wrapped from number
api.setParameter("report_html", html);                     // auto-wrapped from string

// Pass a full envelope when you want explicit metadata:
api.setParameter("result", {
  _meta: { type: "json_array", rowCount: rows.length, columns: Object.keys(rows[0]) },
  data: rows
});
```

### Data loading rules

Data is auto-parsed when pasted. The type is detected, not declared by the user:

- **CSV** (any text with a header row + data rows, even 1 column): stored as `[{col: "val"}, ...]`
- **JSON**: stored as parsed object or array
- **Plain text**: stored as a string (no header row detected)

**All CSV values are strings.** A column named `amount` with value `"1500"` is the string `"1500"`, not the number `1500`. Always use `parseFloat()` or `Number()` for math.

**Single-column CSV is still an array of objects.** If the user pastes `date\n2026-04-21`, the tool receives `[{"date":"2026-04-21"}]`, not `"2026-04-21"`. Access it as `data[0].date`.

**Critical:** `api.getParameter()` already unwraps the envelope. Never access `.data` on the result. If the prior tool set `{ _meta: {...}, data: rows }`, then `api.getParameter()` returns `rows` directly.
