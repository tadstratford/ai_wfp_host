import { describe, it, expect } from "bun:test";
import { validateWidgetData } from "./validate";
import { render, getWidgetDefinition, type TemplateContext } from "./index";
import "./account-table"; // side-effect: registers the account-table widget

const ctx: TemplateContext = { databaseId: "d", sessionId: "s", messageId: "m" };
const def = getWidgetDefinition("account-table")!;

describe("validateWidgetData (account-table)", () => {
  it("accepts a valid payload", () => {
    const data = [{ account: "1000", description: "Cash", balance: 1234 }];
    expect(validateWidgetData(def, data)).toEqual([]);
  });

  it("flags a wrong-typed field", () => {
    const data = [{ account: "1000", balance: "not-a-number" }];
    const errors = validateWidgetData(def, data);
    expect(errors.some((e) => e.includes("number"))).toBe(true);
  });
});

describe("render validation", () => {
  it("returns an error block instead of crashing on malformed data", () => {
    const html = render("account-table", [{ balance: "x" }], ctx);
    expect(html).toContain("invalid data");
  });

  it("renders the widget for valid data", () => {
    const html = render(
      "account-table",
      [{ account: "1000", description: "Cash", balance: 1234 }],
      ctx,
    );
    expect(html).toContain("Cash");
    expect(html).not.toContain("invalid data");
  });
});
