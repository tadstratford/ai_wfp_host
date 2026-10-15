import { describe, expect, test } from "bun:test";
import { generateFakeValue, detectValueType } from "./fakeGen";

describe("generateFakeValue", () => {
  test("is deterministic for a given input", () => {
    const a = generateFakeValue("John Smith");
    const b = generateFakeValue("John Smith");
    expect(a).toBe(b);
  });

  test("distinct inputs map to distinct stand-ins", () => {
    expect(generateFakeValue("John Smith")).not.toBe(generateFakeValue("Jane Doe"));
  });

  test("never returns the real value", () => {
    for (const v of ["John Smith", "510-556-2435", "alice@example.com", "Pine ln"]) {
      expect(generateFakeValue(v)).not.toBe(v);
    }
  });

  test("preserves semantic type", () => {
    const email = generateFakeValue("alice@example.com");
    expect(email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

    const ssn = generateFakeValue("342-98-7234");
    expect(ssn).toMatch(/^\d{3}-\d{2}-\d{4}$/);

    const phone = generateFakeValue("(555) 123-4567");
    expect(phone).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);

    const card = generateFakeValue("4111111111111111");
    expect(card).toMatch(/^\d{16}$/);
    // Luhn-valid
    let sum = 0;
    let double = false;
    for (let i = card.length - 1; i >= 0; i--) {
      let d = card.charCodeAt(i) - 48;
      if (double) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      double = !double;
    }
    expect(sum % 10).toBe(0);
  });

  test("preserves org legal suffix", () => {
    expect(generateFakeValue("Meridian Europe GmbH")).toMatch(/GmbH$/);
    expect(generateFakeValue("Acme Holdings LLC")).toMatch(/LLC$/);
    expect(generateFakeValue("First National Bank")).toMatch(/Bank$/);
  });

  test("preserves person-name word count", () => {
    expect(generateFakeValue("John Smith").split(/\s+/).length).toBe(2);
    expect(generateFakeValue("John David Smith").split(/\s+/).length).toBe(3);
  });

  test("address keeps house number + suffix shape", () => {
    const a = generateFakeValue("123 Main St");
    expect(a.startsWith("123 ")).toBe(true);
    expect(detectValueType(a)).toBe("address");
  });
});

describe("detectValueType (address)", () => {
  test("classifies street addresses", () => {
    expect(detectValueType("Pine ln")).toBe("address");
    expect(detectValueType("510 Main St")).toBe("address");
    expect(detectValueType("42 Elm Avenue")).toBe("address");
  });

  test("does not classify non-address text as address", () => {
    expect(detectValueType("Checking")).toBeNull();
    expect(detectValueType("IT Support Allocation")).toBeNull();
    expect(detectValueType("Partial return of components")).toBeNull();
  });
});
