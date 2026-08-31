import { describe, expect, test } from "vitest";

import { buildSessionPlan, type DomainWeight, type PoolQuestion } from "./generator";

/** CBAP's blueprint, in framework domain order. */
const CBAP: DomainWeight[] = [
  { code: "BAPM", weight: 14 }, { code: "EC", weight: 12 }, { code: "RLCM", weight: 15 },
  { code: "SA", weight: 15 }, { code: "RADD", weight: 30 }, { code: "SE", weight: 14 },
];
const CODES = CBAP.map((d) => d.code);

let nextId = 1;

function q(domain: string, overrides: Partial<PoolQuestion> = {}): PoolQuestion {
  return { id: nextId++, domain, caseStudyId: null, lastSeenAt: null, ...overrides };
}

/** A pool with `per` questions in every domain. */
function evenPool(per: number): PoolQuestion[] {
  return CODES.flatMap((d) => Array.from({ length: per }, () => q(d)));
}

function countByKa(pool: PoolQuestion[], ids: number[]): Record<string, number> {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const d = byId.get(id)!.domain;
    counts[d] = (counts[d] ?? 0) + 1;
  }
  return counts;
}

describe("buildSessionPlan", () => {
  test("delivers exactly the requested number of questions", () => {
    const pool = evenPool(40);
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 1 });
    expect(plan.questionIds).toHaveLength(120);
  });

  test("a full mock exam follows the IIBA blueprint", () => {
    const pool = evenPool(40);
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 1 });
    expect(countByKa(pool, plan.questionIds)).toEqual({
      RADD: 36,
      SA: 18,
      RLCM: 18,
      BAPM: 17,
      SE: 17,
      EC: 14,
    });
  });

  test("never repeats a question within a session", () => {
    const plan = buildSessionPlan({ domains: CBAP, pool: evenPool(40), total: 120, seed: 3 });
    expect(new Set(plan.questionIds).size).toBe(plan.questionIds.length);
  });

  test("restricting to one domain draws only from that domain", () => {
    const pool = evenPool(30);
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 20, domain: "SA", seed: 1 });
    expect(countByKa(pool, plan.questionIds)).toEqual({ SA: 20 });
  });

  test("prefers questions the learner has never seen", () => {
    const fresh = q("SA");
    const stale = q("SA", { lastSeenAt: 1_000 });
    const plan = buildSessionPlan({ domains: CBAP, pool: [stale, fresh], total: 1, domain: "SA", seed: 1 });
    expect(plan.questionIds).toEqual([fresh.id]);
  });

  test("among seen questions, brings back the least recently seen first", () => {
    const older = q("SA", { lastSeenAt: 100 });
    const newer = q("SA", { lastSeenAt: 900 });
    const plan = buildSessionPlan({ domains: CBAP, pool: [newer, older], total: 1, domain: "SA", seed: 1 });
    expect(plan.questionIds).toEqual([older.id]);
  });

  test("backfills from other areas when one area is short, and says so", () => {
    const pool = CODES.filter((d) => d !== "EC").flatMap((d) =>
      Array.from({ length: 40 }, () => q(d)),
    );
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 1 });
    expect(plan.questionIds).toHaveLength(120);
    expect(plan.shortfallByDomain.EC).toBe(14);
    expect(countByKa(pool, plan.questionIds).EC).toBeUndefined();
  });

  test("returns everything available when the pool is smaller than the request", () => {
    const pool = evenPool(2);
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 1 });
    expect(plan.questionIds).toHaveLength(12);
  });

  test("keeps questions from the same case study together", () => {
    // RADD holds nothing but one 4-question case study, so the group is
    // guaranteed to be drawn and its adjacency is what is under test.
    const pool = [
      ...Array.from({ length: 4 }, () => q("RADD", { caseStudyId: 7 })),
      ...Array.from({ length: 20 }, () => q("SA")),
      ...Array.from({ length: 20 }, () => q("RLCM")),
    ];
    const byId = new Map(pool.map((p) => [p.id, p]));
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 24, seed: 5 });

    const positions = plan.questionIds
      .map((id, i) => ({ i, caseStudyId: byId.get(id)!.caseStudyId }))
      .filter((x) => x.caseStudyId === 7)
      .map((x) => x.i);

    expect(positions).toHaveLength(4);
    expect(positions.at(-1)! - positions[0]).toBe(3);
  });

  test("does not split a case study across the quota boundary", () => {
    const pool = [
      ...Array.from({ length: 5 }, () => q("SA", { caseStudyId: 1 })),
      ...Array.from({ length: 10 }, () => q("SA")),
    ];
    const byId = new Map(pool.map((p) => [p.id, p]));
    // Only 3 slots: the 5-question case study cannot fit, so it is skipped.
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 3, domain: "SA", seed: 1 });
    expect(plan.questionIds).toHaveLength(3);
    expect(plan.questionIds.every((id) => byId.get(id)!.caseStudyId === null)).toBe(true);
  });

  test("the same seed rebuilds an identical exam", () => {
    const pool = evenPool(40);
    expect(buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 77 })).toEqual(
      buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 77 }),
    );
  });

  test("different seeds produce different exams", () => {
    const pool = evenPool(40);
    const a = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 1 }).questionIds;
    const b = buildSessionPlan({ domains: CBAP, pool, total: 120, seed: 2 }).questionIds;
    expect(a).not.toEqual(b);
  });

  test("ignoring the blueprint draws purely by freshness, not by weighting", () => {
    // Wrong-answer review must serve back the questions the learner actually
    // missed, not reshape them into a 30%-RADD exam.
    const pool = [
      ...Array.from({ length: 10 }, () => q("EC")),
      ...Array.from({ length: 2 }, () => q("RADD")),
    ];
    const plan = buildSessionPlan({ domains: CBAP, pool, total: 12, seed: 1, blueprint: false });
    expect(plan.questionIds).toHaveLength(12);
    expect(countByKa(pool, plan.questionIds)).toEqual({ EC: 10, RADD: 2 });
    expect(plan.shortfallByDomain).toEqual({});
  });

  test("an empty pool yields an empty plan rather than throwing", () => {
    const plan = buildSessionPlan({ domains: CBAP, pool: [], total: 120, seed: 1 });
    expect(plan.questionIds).toEqual([]);
  });
});
