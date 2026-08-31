import { describe, expect, test } from "vitest";

import { createRng, seededShuffle } from "./rng";

describe("createRng", () => {
  test("the same seed replays the same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    expect(first).toEqual(second);
  });

  test("different seeds diverge", () => {
    const a = Array.from({ length: 10 }, createRng(1));
    const b = Array.from({ length: 10 }, createRng(2));
    expect(a).not.toEqual(b);
  });

  test("every value lands in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seededShuffle", () => {
  const items = ["A", "B", "C", "D"];

  test("keeps every element exactly once", () => {
    expect([...seededShuffle(items, 3)].sort()).toEqual(["A", "B", "C", "D"]);
  });

  test("the same seed produces the same order", () => {
    expect(seededShuffle(items, 99)).toEqual(seededShuffle(items, 99));
  });

  test("different seeds usually produce different orders", () => {
    const orders = new Set(
      Array.from({ length: 20 }, (_, seed) => seededShuffle(items, seed).join("")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  test("does not mutate the input", () => {
    const original = [...items];
    seededShuffle(items, 5);
    expect(items).toEqual(original);
  });

  test("handles empty and single-element lists", () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(["only"], 1)).toEqual(["only"]);
  });
});
