import { describe, it, expect } from "bun:test";
import { buildClarifyQuestion } from "./clarify";

describe("buildClarifyQuestion", () => {
  it("formats missing params into a readable question", async () => {
    const q = await buildClarifyQuestion([
      "report_qbo_bs.start_date",
      "report_qbo_bs.end_date",
    ]);
    expect(q).toContain("I need a bit more information to proceed");
    expect(q).toContain("start date");
    expect(q).toContain("end date");
  });

  it("groups by tool and dedupes repeated params", async () => {
    const q = await buildClarifyQuestion([
      "foo.bar",
      "foo.bar",
      "foo.baz",
      "qux.quux",
    ]);
    const bullets = q.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets).toEqual(["- bar", "- baz", "- quux"]);
  });
});
