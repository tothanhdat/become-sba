import { describe, expect, test } from "vitest";

import { scoreSession, type AnsweredQuestion } from "./scoring";

/** The six BABOK knowledge areas, as a CBAP or CCBA session would supply them. */
const BABOK = ["BAPM", "EC", "RLCM", "SA", "RADD", "SE"];
const THRESHOLD = 70;

function answer(domain: string, correct: boolean): AnsweredQuestion {
  return { domain, selectedOptionId: correct ? 1 : 2, correctOptionId: 1 };
}

function unanswered(domain: string): AnsweredQuestion {
  return { domain, selectedOptionId: null, correctOptionId: 1 };
}

function repeat(domain: string, correct: number, wrong: number): AnsweredQuestion[] {
  return [
    ...Array.from({ length: correct }, () => answer(domain, true)),
    ...Array.from({ length: wrong }, () => answer(domain, false)),
  ];
}

const score = (answers: AnsweredQuestion[], domains = BABOK) =>
  scoreSession(answers, domains, THRESHOLD);

describe("scoreSession", () => {
  test("counts correct answers", () => {
    const result = score(repeat("RADD", 3, 2));
    expect(result.correct).toBe(3);
    expect(result.total).toBe(5);
  });

  test("treats an unanswered question as wrong", () => {
    const result = score([answer("SA", true), unanswered("SA")]);
    expect(result.correct).toBe(1);
    expect(result.unanswered).toBe(1);
  });

  test("passes at exactly the 70 percent threshold", () => {
    const result = score(repeat("RADD", 84, 36));
    expect(result.percent).toBe(70);
    expect(result.passed).toBe(true);
  });

  test("fails one question below the threshold", () => {
    const result = score(repeat("RADD", 83, 37));
    expect(result.passed).toBe(false);
  });

  test("does not pass a score that only reaches 70 percent after rounding", () => {
    // 1399/2000 = 69.95%, which displays as 70.0 but is not a pass.
    const result = score(repeat("RADD", 1399, 601));
    expect(result.percent).toBe(70);
    expect(result.passed).toBe(false);
  });

  test("breaks the score down by knowledge area", () => {
    const result = score([...repeat("RADD", 3, 1), ...repeat("EC", 1, 3)]);
    expect(result.byDomain.RADD).toEqual({ total: 4, correct: 3, percent: 75 });
    expect(result.byDomain.EC).toEqual({ total: 4, correct: 1, percent: 25 });
  });

  test("reports every domain the certification has, including untested ones", () => {
    const result = score(repeat("RADD", 1, 0));
    expect(Object.keys(result.byDomain).sort()).toEqual([...BABOK].sort());
    expect(result.byDomain.EC).toEqual({ total: 0, correct: 0, percent: 0 });
  });

  test("scores a certification with a completely different domain set", () => {
    // ECBA's nine performance domains share no codes with BABOK.
    const ecba = ["UBA", "MEBA", "IBA", "CHG", "NEED", "SOL", "STK", "VAL", "CTX"];
    const result = score(repeat("UBA", 3, 1), ecba);
    expect(Object.keys(result.byDomain)).toHaveLength(9);
    expect(result.byDomain.UBA).toEqual({ total: 4, correct: 3, percent: 75 });
  });

  test("honours a certification's own pass threshold", () => {
    const answers = repeat("RADD", 6, 4);
    expect(scoreSession(answers, BABOK, 60).passed).toBe(true);
    expect(scoreSession(answers, BABOK, 65).passed).toBe(false);
  });

  test("scores an empty session as zero rather than dividing by zero", () => {
    const result = score([]);
    expect(result).toMatchObject({ total: 0, correct: 0, percent: 0, passed: false });
  });

  test("rounds the displayed percentage to one decimal", () => {
    expect(score(repeat("RADD", 1, 2)).percent).toBe(33.3);
  });
});
