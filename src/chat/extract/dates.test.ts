import { describe, it, expect } from "bun:test";
import { resolveRange, resolveDate } from "./dates";

// Fixed clock so the assertions are deterministic regardless of when the tests run.
const NOW = new Date(2026, 9, 12); // 2026-10-12
const y2026 = { start: "2026-01-01", end: "2026-12-31" };
const y2025 = { start: "2025-01-01", end: "2025-12-31" };
const y2024 = { start: "2024-01-01", end: "2024-12-31" };

describe("resolveRange — bare \"the <unit>\"", () => {
  it("resolves \"the year\" to the current calendar year", () => {
    expect(resolveRange("what is total Plants and Soil for the year", NOW)).toEqual(y2026);
    expect(resolveRange("show me the year", NOW)).toEqual(y2026);
  });

  it("resolves \"the month\" to the current month", () => {
    expect(resolveRange("P&L for the month", NOW)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  it("resolves \"the quarter\" to the current quarter", () => {
    expect(resolveRange("spend by the quarter", NOW)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("does not hijack an explicit year after \"the\"", () => {
    expect(resolveRange("the year 2024", NOW)).toEqual(y2024);
    expect(resolveRange("for the year 2024", NOW)).toEqual(y2024);
  });

  it("does not hijack an explicit month after \"the\"", () => {
    expect(resolveRange("the month of March 2025", NOW)).toEqual({
      start: "2025-03-01",
      end: "2025-03-31",
    });
  });
});

describe("resolveRange — existing relative units", () => {
  it("resolves this/current/last/next year", () => {
    expect(resolveRange("this year", NOW)).toEqual(y2026);
    expect(resolveRange("current year", NOW)).toEqual(y2026);
    expect(resolveRange("last year", NOW)).toEqual(y2025);
    expect(resolveRange("next year", NOW)).toEqual({ start: "2027-01-01", end: "2027-12-31" });
  });

  it("resolves fiscal years", () => {
    expect(resolveRange("FY2026", NOW)).toEqual(y2026);
    expect(resolveRange("FY25", NOW)).toEqual(y2025);
  });

  it("resolves a bare year", () => {
    expect(resolveRange("2025", NOW)).toEqual(y2025);
  });

  it("resolves an explicit ISO pair", () => {
    expect(resolveRange("from 2026-01-01 to 2026-03-31", NOW)).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    });
  });
});

describe("resolveDate", () => {
  it("resolves today", () => {
    expect(resolveDate("today", NOW)).toBe("2026-10-12");
  });

  it("returns null when nothing date-like is present", () => {
    expect(resolveDate("hello world", NOW)).toBeNull();
  });
});
