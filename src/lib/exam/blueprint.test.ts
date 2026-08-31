import { describe, expect, test } from "vitest";

import { allocateByBlueprint, type DomainWeight } from "./blueprint";

/** The three real IIBA blueprints, in framework domain order. */
const CBAP: DomainWeight[] = [
  { code: "BAPM", weight: 14 }, { code: "EC", weight: 12 }, { code: "RLCM", weight: 15 },
  { code: "SA", weight: 15 }, { code: "RADD", weight: 30 }, { code: "SE", weight: 14 },
];
const CCBA: DomainWeight[] = [
  { code: "BAPM", weight: 12 }, { code: "EC", weight: 20 }, { code: "RLCM", weight: 18 },
  { code: "SA", weight: 12 }, { code: "RADD", weight: 32 }, { code: "SE", weight: 6 },
];
const ECBA: DomainWeight[] = [
  { code: "UBA", weight: 20 }, { code: "MEBA", weight: 14 }, { code: "IBA", weight: 6 },
  { code: "CHG", weight: 10 }, { code: "NEED", weight: 10 }, { code: "SOL", weight: 10 },
  { code: "STK", weight: 10 }, { code: "VAL", weight: 10 }, { code: "CTX", weight: 10 },
];

const sum = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0);

describe("allocateByBlueprint", () => {
  test("splits a 120-question CBAP exam by the IIBA blueprint", () => {
    expect(allocateByBlueprint(120, CBAP)).toEqual({
      RADD: 36, SA: 18, RLCM: 18, BAPM: 17, SE: 17, EC: 14,
    });
  });

  test("splits a 130-question CCBA exam by its own, different blueprint", () => {
    expect(allocateByBlueprint(130, CCBA)).toEqual({
      RADD: 41, EC: 26, RLCM: 23, BAPM: 16, SA: 16, SE: 8,
    });
  });

  test("splits a 50-question ECBA exam across its nine performance domains", () => {
    expect(allocateByBlueprint(50, ECBA)).toEqual({
      UBA: 10, MEBA: 7, IBA: 3, CHG: 5, NEED: 5, SOL: 5, STK: 5, VAL: 5, CTX: 5,
    });
  });

  test("allocated counts always sum to the requested total, for every blueprint", () => {
    for (const domains of [CBAP, CCBA, ECBA]) {
      for (let total = 0; total <= 200; total++) {
        expect(sum(allocateByBlueprint(total, domains)), `total=${total}`).toBe(total);
      }
    }
  });

  test("never allocates a negative count", () => {
    for (let total = 0; total <= 200; total++) {
      for (const n of Object.values(allocateByBlueprint(total, CCBA))) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("returns a key for every domain, even one that gets nothing", () => {
    const allocation = allocateByBlueprint(1, CCBA);
    expect(Object.keys(allocation).sort()).toEqual(CCBA.map((d) => d.code).sort());
    expect(allocation.SE).toBe(0);
  });

  test("gives the single question to the heaviest domain", () => {
    expect(allocateByBlueprint(1, CCBA).RADD).toBe(1);
  });

  test("normalises weights that do not sum to 100", () => {
    const half: DomainWeight[] = [{ code: "A", weight: 1 }, { code: "B", weight: 1 }];
    expect(allocateByBlueprint(10, half)).toEqual({ A: 5, B: 5 });
  });

  test("breaks remainder ties by domain order, so the result is reproducible", () => {
    expect(allocateByBlueprint(6, CBAP)).toEqual(allocateByBlueprint(6, CBAP));
    // SA and RLCM both weigh 15%; RLCM comes first in framework order.
    const tie: DomainWeight[] = [{ code: "FIRST", weight: 50 }, { code: "SECOND", weight: 50 }];
    expect(allocateByBlueprint(1, tie)).toEqual({ FIRST: 1, SECOND: 0 });
  });

  test("an empty blueprint allocates nothing", () => {
    expect(allocateByBlueprint(0, [])).toEqual({});
  });

  test("rejects a negative total", () => {
    expect(() => allocateByBlueprint(-1, CBAP)).toThrow();
  });

  test("rejects a blueprint whose weights are all zero", () => {
    expect(() => allocateByBlueprint(10, [{ code: "A", weight: 0 }])).toThrow(/weight/i);
  });
});
