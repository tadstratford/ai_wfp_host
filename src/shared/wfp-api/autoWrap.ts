// Envelope helpers — wrap raw tool return values into TypedEnvelope so the
// runner can carry type metadata alongside the data. The hosted app and OSS
// runners both rely on this exact shape (`_meta`, `data`) so an envelope is
// portable across runners.

import type { TypedEnvelope } from "./types";

export function isEnvelope(v: unknown): v is TypedEnvelope {
  return !!(
    v &&
    typeof v === "object" &&
    "_meta" in v &&
    "data" in v &&
    typeof (v as TypedEnvelope)._meta?.type === "string"
  );
}

export function autoWrap(value: unknown): TypedEnvelope {
  if (isEnvelope(value)) return value;
  if (typeof value === "string") {
    return { _meta: { type: "text", length: value.length }, data: value };
  }
  if (typeof value === "number") {
    return { _meta: { type: "number" }, data: value };
  }
  if (typeof value === "boolean") {
    return { _meta: { type: "boolean" }, data: value };
  }
  if (Array.isArray(value)) {
    const columns =
      value.length > 0 && typeof value[0] === "object" && value[0] !== null
        ? Object.keys(value[0] as object)
        : undefined;
    return {
      _meta: { type: "json_array", rowCount: value.length, columns },
      data: value,
    };
  }
  if (value && typeof value === "object") {
    return { _meta: { type: "json_object" }, data: value };
  }
  return { _meta: { type: "string" }, data: String(value ?? "") };
}
