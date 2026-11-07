import { describe, expect, test } from "bun:test";
import { isTieOutRequest } from "./cascade";

describe("isTieOutRequest", () => {
  test("detects the reported tie-out phrasing", () => {
    expect(isTieOutRequest("can you check if the supporting schedules tie to the trial balance")).toBe(true);
  });

  test("detects reconcile-to-trial-balance phrasing", () => {
    expect(isTieOutRequest("do the schedules reconcile to the trial balance")).toBe(true);
  });

  test("rejects a plain reconcile without a trial-balance/schedule target", () => {
    expect(isTieOutRequest("reconcile the bank account")).toBe(false);
  });

  test("rejects a generic review", () => {
    expect(isTieOutRequest("review the data for errors")).toBe(false);
  });
});
