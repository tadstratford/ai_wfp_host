import { describe, expect, test } from "bun:test";
import { reconcileTables } from "./reconcile";

describe("reconcileTables", () => {
  const on = ["ID"];
  const compare = ["Amount", "Category"];

  test("matches identical rows", () => {
    const left = [{ ID: "a1", Amount: "10.00", Category: "x" }];
    const right = [{ ID: "a1", Amount: 10, Category: "x" }];
    const r = reconcileTables(left, right, on, compare);
    expect(r.summary).toEqual({ matched: 1, mismatched: 0, missing_left: 0, missing_right: 0 });
    expect(r.mismatches).toHaveLength(0);
  });

  test("flags a numeric mismatch with the difference", () => {
    const left = [{ ID: "a1", Amount: "10.00", Category: "x" }];
    const right = [{ ID: "a1", Amount: "13.00", Category: "x" }];
    const r = reconcileTables(left, right, on, compare);
    expect(r.summary.mismatched).toBe(1);
    const v = r.mismatches[0].values.find((x) => x.column === "Amount")!;
    expect(v.difference).toBe(3);
  });

  test("treats a difference within tolerance as a match", () => {
    const left = [{ ID: "a1", Amount: "10.00" }];
    const right = [{ ID: "a1", Amount: "10.005" }];
    const r = reconcileTables(left, right, on, ["Amount"], 0.01);
    expect(r.summary.matched).toBe(1);
  });

  test("reports rows present on only one side", () => {
    const left = [{ ID: "a1" }, { ID: "a2" }];
    const right = [{ ID: "a1" }, { ID: "a3" }];
    const r = reconcileTables(left, right, on, []);
    expect(r.summary.missing_right).toBe(1);
    expect(r.summary.missing_left).toBe(1);
  });

  test("compares non-numeric values as strings", () => {
    const left = [{ ID: "a1", Category: "x" }];
    const right = [{ ID: "a1", Category: "y" }];
    const r = reconcileTables(left, right, on, ["Category"]);
    expect(r.summary.mismatched).toBe(1);
    expect(r.mismatches[0].values[0].difference).toBeNull();
  });
});
