import { describe, expect, test } from "bun:test";
import { dropChainEntries, type PrivacyEntry } from "./privacy";

const e = (real: string, fake: string): PrivacyEntry => ({
  real,
  fake,
  source: "automatic",
});

describe("dropChainEntries", () => {
  test("drops entries whose real value is another entry's fake", () => {
    const entries = [
      e("Franklin Fund LP", "South Maple LP"),
      e("South Maple LP", "Pine Harbor LP"),
      e("Pine Harbor LP", "Cedar Ridge LP"),
    ];
    expect(dropChainEntries(entries)).toEqual([
      e("Franklin Fund LP", "South Maple LP"),
    ]);
  });

  test("keeps unrelated entries", () => {
    const entries = [
      e("Franklin Fund LP", "South Maple LP"),
      e("Franklin Management Co", "Pioneer West Co"),
    ];
    expect(dropChainEntries(entries)).toEqual(entries);
  });

  test("drops self-mapped entries (real === fake)", () => {
    expect(dropChainEntries([e("Acme", "Acme")])).toEqual([]);
  });

  test("reproduces the reported remasking chain", () => {
    const entries = [
      e("Franklin Management Co", "Pioneer West Co"),
      e("Franklin Fund LP", "South Maple LP"),
      e("Franklin GP LLC", "River Clear LLC"),
      e("Pioneer West Co", "Vertex South Co"),
      e("South Maple LP", "Pine Harbor LP"),
      e("River Clear LLC", "Alder Granite LLC"),
    ];
    expect(dropChainEntries(entries)).toEqual([
      e("Franklin Management Co", "Pioneer West Co"),
      e("Franklin Fund LP", "South Maple LP"),
      e("Franklin GP LLC", "River Clear LLC"),
    ]);
  });
});
