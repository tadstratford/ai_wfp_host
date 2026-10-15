import { describe, it, expect } from "bun:test";
import { resolveTemplates, setParameterValue } from "./parameterHelpers";

function params() {
  return setParameterValue(
    setParameterValue(
      undefined,
      "html",
      { _meta: { type: "text" }, data: "<html>hi</html>" },
    ),
    "rows",
    { _meta: { type: "json_array" }, data: [{ a: 1 }] },
  );
}

describe("resolveTemplates", () => {
  it("resolves an exact {{name}} to its stored string value", () => {
    expect(resolveTemplates("{{html}}", params())).toBe("<html>hi</html>");
  });

  it("JSON-stringifies an object value on exact match", () => {
    expect(resolveTemplates("{{rows}}", params())).toBe(JSON.stringify([{ a: 1 }]));
  });

  it("interpolates partial references", () => {
    expect(resolveTemplates("report: {{html}} done", params())).toBe(
      "report: <html>hi</html> done",
    );
  });

  it("recurses through objects and arrays", () => {
    expect(resolveTemplates({ data: "{{html}}", list: ["{{html}}"] }, params())).toEqual({
      data: "<html>hi</html>",
      list: ["<html>hi</html>"],
    });
  });

  it("leaves unresolved references as-is", () => {
    expect(resolveTemplates("{{missing}}", params())).toBe("{{missing}}");
  });
});
