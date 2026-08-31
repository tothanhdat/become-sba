import { beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import { questionOptions } from "@/lib/db/schema";
import { seedCatalogAndBank } from "@/test-support/bank";
import { getCertification } from "@/lib/catalog";
import { getReadiness, getSessionHistory } from "./analytics";
import { createSession, getSessionForTaking, saveAnswer, submitSession } from "./exam/sessions";
import { eq } from "drizzle-orm";

let db: Db;

function seedBank(per: number): void {
  seedCatalogAndBank(db, per);
}

const cbap = () => getCertification(db, "CBAP")!;

function correctOptionId(questionId: number): number {
  return db
    .select({ id: questionOptions.id })
    .from(questionOptions)
    .where(eq(questionOptions.questionId, questionId))
    .all()
    .find((_, i) => i === 0)!.id;
}

/** Answers the first `correct` questions right and the rest wrong. */
function play(sessionId: number, correct: number): void {
  const view = getSessionForTaking(db, sessionId);
  view.questions.forEach((q, i) => {
    const right = correctOptionId(q.questionId);
    const chosen = i < correct ? right : q.options.find((o) => o.id !== right)!.id;
    saveAnswer(db, sessionId, q.questionId, { selectedOptionId: chosen });
  });
  submitSession(db, sessionId);
}

beforeEach(() => {
  db = createDatabase(":memory:");
});

describe("getReadiness", () => {
  test("reports zeros before any exam has been taken", () => {
    seedBank(3);
    const readiness = getReadiness(db, cbap());
    expect(readiness.answered).toBe(0);
    expect(readiness.overallPercent).toBe(0);
    expect(readiness.byDomain.RADD).toEqual({ total: 0, correct: 0, percent: 0 });
  });

  test("measures accuracy across graded sessions", () => {
    seedBank(4);
    const id = createSession(db, { certificationCode: "CBAP", mode: "quick", total: 12 });
    play(id, 9);

    const readiness = getReadiness(db, cbap());
    expect(readiness.answered).toBe(12);
    expect(readiness.correct).toBe(9);
    expect(readiness.overallPercent).toBe(75);
  });

  test("ignores sessions that were never submitted", () => {
    seedBank(4);
    createSession(db, { certificationCode: "CBAP", mode: "quick", total: 12 });
    expect(getReadiness(db, cbap()).answered).toBe(0);
  });

  test("names the weakest domains so the learner knows where to study", () => {
    seedBank(4);
    const id = createSession(db, { certificationCode: "CBAP", mode: "quick", total: 24 });
    play(id, 12);

    const readiness = getReadiness(db, cbap());
    expect(readiness.weakestDomains.length).toBeGreaterThan(0);
    const percents = readiness.weakestDomains.map((k) => readiness.byDomain[k].percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });
});

describe("getSessionHistory", () => {
  test("is empty at the start", () => {
    seedBank(1);
    expect(getSessionHistory(db, cbap())).toEqual([]);
  });

  test("lists graded sessions newest first", () => {
    seedBank(4);
    const first = createSession(db, { certificationCode: "CBAP", mode: "quick", total: 6, now: 1_000 });
    play(first, 6);
    const second = createSession(db, { certificationCode: "CBAP", mode: "quick", total: 6, now: 2_000 });
    play(second, 3);

    const history = getSessionHistory(db, cbap());
    expect(history.map((h) => h.id)).toEqual([second, first]);
    expect(history[0].percent).toBe(50);
    expect(history[1].percent).toBe(100);
  });

  test("leaves unsubmitted sessions out of the history", () => {
    seedBank(4);
    createSession(db, { certificationCode: "CBAP", mode: "quick", total: 6 });
    expect(getSessionHistory(db, cbap())).toEqual([]);
  });
});
