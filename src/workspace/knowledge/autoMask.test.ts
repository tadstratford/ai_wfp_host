import { describe, expect, test } from "bun:test";
import {
  maskValue,
  maskText,
  unmaskTokens,
  detectValueType,
  buildTextMasker,
  collectRequestCandidates,
  hasToolResultBlocks,
} from "./autoMask";

describe("detectValueType", () => {
  test("classifies structured PII and legal-entity orgs", () => {
    expect(detectValueType("alice@example.com")).toBe("email");
    expect(detectValueType("123-45-6789")).toBe("ssn");
    expect(detectValueType("12-3456789")).toBe("ein");
    expect(detectValueType("(555) 123-4567")).toBe("phone");
    expect(detectValueType("Meridian Europe GmbH")).toBe("name");
    expect(detectValueType("Acme Holdings LLC")).toBe("name");
  });

  test("does not classify dates, numbers, or operational text", () => {
    expect(detectValueType("2026-07-01")).toBeNull();
    expect(detectValueType("07/15/2026")).toBeNull();
    expect(detectValueType("1000.00")).toBeNull();
    expect(detectValueType("Partial return of components")).toBeNull();
    expect(detectValueType("IT Support Allocation")).toBeNull();
    expect(detectValueType("Checking")).toBeNull();
  });

  test("does not mask money, bare account numbers, or non-Luhn card-length numbers", () => {
    expect(detectValueType("12345.67")).toBeNull();
    expect(detectValueType("$1,234.56")).toBeNull();
    expect(detectValueType("(1,234.56)")).toBeNull();
    expect(detectValueType("100000.00")).toBeNull();
    expect(detectValueType("1234567")).toBeNull();
    expect(detectValueType("123456789012")).toBeNull();
    expect(detectValueType("1234567890123456")).toBeNull();
  });

  test("still masks Luhn-valid cards and formatted phones", () => {
    expect(detectValueType("4111111111111111")).toBe("card");
    expect(detectValueType("5551234567")).toBe("phone");
    expect(detectValueType("+44 20 7946 0958")).toBe("phone");
  });
});

describe("buildTextMasker", () => {
  test("masks entities inside free text, leaves the rest readable", () => {
    const forward = new Map<string, string>([
      ["Meridian Europe GmbH", "<name_001>"],
    ]);
    const masker = buildTextMasker(forward);
    expect(masker.mask("Payment to Meridian Europe GmbH")).toBe("Payment to <name_001>");
    expect(masker.mask("Partial return of components")).toBe("Partial return of components");
  });

  test("matches longest entity first", () => {
    const forward = new Map<string, string>([
      ["Meridian", "<name_001>"],
      ["Meridian Europe GmbH", "<name_002>"],
    ]);
    const masker = buildTextMasker(forward);
    expect(masker.mask("Meridian Europe GmbH and Meridian")).toBe("<name_002> and <name_001>");
  });

  test("no-op when the map is empty", () => {
    const masker = buildTextMasker(new Map());
    expect(masker.mask("anything")).toBe("anything");
  });
});

describe("auto-mask pure helpers", () => {
  test("maskValue maps exact values, leaves others untouched", () => {
    const forward = new Map<string, string>([
      ["Acme Corp", "<name_001>"],
      ["Beta LLC", "<name_002>"],
    ]);
    expect(maskValue("Acme Corp", forward)).toBe("<name_001>");
    expect(maskValue(" Other ", forward)).toBe(" Other ");
    expect(maskValue("Gamma", forward)).toBe("Gamma");
  });

  test("maskText replaces longest values first", () => {
    const forward = new Map<string, string>([
      ["Acme", "<name_001>"],
      ["Acme Corp", "<name_002>"],
    ]);
    expect(maskText("Acme Corp owns Acme", forward)).toBe("<name_002> owns <name_001>");
  });

  test("unmaskTokens reverses type-aware tokens", () => {
    const reverse = new Map<string, string>([
      ["<name_001>", "Acme Corp"],
      ["<vendor_042>", "Smithco"],
    ]);
    expect(unmaskTokens("Paid <name_001> by <vendor_042>", reverse)).toBe(
      "Paid Acme Corp by Smithco",
    );
  });

  test("unmaskTokens leaves unknown angle tokens alone", () => {
    expect(unmaskTokens("<e0> and <name_001>", new Map([["<name_001>", "Acme"]]))).toBe(
      "<e0> and Acme",
    );
  });
});

describe("collectRequestCandidates", () => {
  test("collects entity DisplayName/CompanyName from JSON tool results", () => {
    const candidates = collectRequestCandidates({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: JSON.stringify({
                vendors: [
                  { Id: "1", DisplayName: "Harbor Consulting", CompanyName: "Harbor Consulting LLC" },
                ],
              }),
            },
          ],
        },
      ],
    });
    expect(candidates).toContain("Harbor Consulting");
    expect(candidates).toContain("Harbor Consulting LLC");
  });

  test("collects EntityRef.name but skips AccountRef.name", () => {
    const candidates = collectRequestCandidates({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: JSON.stringify({
                entries: [
                  {
                    lines: [
                      {
                        accountName: "Rent Expense",
                        accountRef: { id: "1", name: "Rent Expense" },
                        entity: { type: "Vendor", name: "Acme Supplies", id: "2" },
                      },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
    expect(candidates).toContain("Acme Supplies");
    expect(candidates).not.toContain("Rent Expense");
  });

  test("collects structured PII spans from free text", () => {
    const candidates = collectRequestCandidates({
      system: "You are an accounting assistant.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: "Contact alice@example.com for details.",
            },
          ],
        },
      ],
    });
    expect(candidates).toContain("alice@example.com");
  });

  test("does not collect account/class/location names", () => {
    const candidates = collectRequestCandidates({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: JSON.stringify({
                accounts: [{ Name: "Checking" }],
                classes: [{ Name: "Operations" }],
                locations: [{ Name: "Main Office" }],
              }),
            },
          ],
        },
      ],
    });
    expect(candidates).toEqual([]);
  });
});

describe("hasToolResultBlocks", () => {
  test("detects tool_result blocks", () => {
    expect(
      hasToolResultBlocks({ messages: [{ content: [{ type: "tool_result" }] }] }),
    ).toBe(true);
    expect(
      hasToolResultBlocks({ messages: [{ content: [{ type: "text" }] }] }),
    ).toBe(false);
    expect(hasToolResultBlocks({ messages: [{ content: "plain string" }] })).toBe(false);
    expect(hasToolResultBlocks({})).toBe(false);
  });
});
