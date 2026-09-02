import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { getCertification } from "@/lib/catalog";
import { importQuestionPack } from "@/lib/content/importer";
import { createDatabase, type Db } from "@/lib/db";
import { bookmarks, questionOptions, questions } from "@/lib/db/schema";
import { toggleBookmark } from "@/lib/notes";
import { createTestUser, sampleBank, seedCatalogAndBank } from "@/test-support/bank";
import {
  createSession,
  getBankCoverage,
  getSessionForTaking,
  getSessionResult,
  loadReviewPool,
  saveAnswer,
  submitSession,
} from "./sessions";

let db: Db;
let userId: string;

const cert = (code: string) => getCertification(db, code)!;

/** Answers every question in a session; `correct` decides right or wrong. */
function answerAll(sessionId: number, correct: boolean): void {
  const view = getSessionForTaking(db, userId, sessionId);
  const keys = correctIds();
  for (const q of view.questions) {
    const right = keys.get(q.questionId)!;
    const chosen = correct ? right : q.options.find((o) => o.id !== right)!.id;
    saveAnswer(db, userId, sessionId, q.questionId, { selectedOptionId: chosen });
  }
}

function correctIds(): Map<number, number> {
  return new Map(
    db
      .select({ questionId: questionOptions.questionId, id: questionOptions.id })
      .from(questionOptions)
      .where(eq(questionOptions.isCorrect, true))
      .all()
      .map((r) => [r.questionId, r.id]),
  );
}

beforeEach(() => {
  db = createDatabase(":memory:");
  userId = createTestUser(db);
});

describe("createSession", () => {
  test("a quick quiz serves the requested number of questions in order", () => {
    seedCatalogAndBank(db, 5);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 10 });
    expect(getSessionForTaking(db, userId, id).questions.map((q) => q.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test("a CBAP mock exam uses CBAP's 120-question, 210-minute format", () => {
    seedCatalogAndBank(db, 25);
    const view = getSessionForTaking(db, userId, createSession(db, userId, { certificationCode: "CBAP", mode: "mock" }));
    expect(view.questions).toHaveLength(120);
    expect(view.session.timeLimitSec).toBe(12600);
    expect(view.session.certificationCode).toBe("CBAP");
  });

  test("a CCBA mock exam uses CCBA's own 130-question, 180-minute format", () => {
    seedCatalogAndBank(db, 30);
    const view = getSessionForTaking(db, userId, createSession(db, userId, { certificationCode: "CCBA", mode: "mock" }));
    expect(view.questions).toHaveLength(130);
    expect(view.session.timeLimitSec).toBe(10800);
  });

  test("the same bank is split by each certification's own blueprint", () => {
    // 45 per domain covers CCBA's heaviest quota (41 RADD) without backfilling.
    seedCatalogAndBank(db, 45);
    const count = (id: number) => {
      const counts: Record<string, number> = {};
      for (const q of getSessionForTaking(db, userId, id).questions) {
        counts[q.domain] = (counts[q.domain] ?? 0) + 1;
      }
      return counts;
    };

    expect(count(createSession(db, userId, { certificationCode: "CBAP", mode: "mock" }))).toEqual({
      RADD: 36, SA: 18, RLCM: 18, BAPM: 17, SE: 17, EC: 14,
    });
    expect(count(createSession(db, userId, { certificationCode: "CCBA", mode: "mock" }))).toEqual({
      RADD: 41, EC: 26, RLCM: 23, BAPM: 16, SA: 16, SE: 8,
    });
  });

  test("practice modes are untimed", () => {
    seedCatalogAndBank(db, 5);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "domain", domain: "SA", total: 5 });
    expect(getSessionForTaking(db, userId, id).session.timeLimitSec).toBeNull();
  });

  test("a domain session only serves that domain", () => {
    seedCatalogAndBank(db, 6);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "domain", domain: "SE", total: 6 });
    expect(getSessionForTaking(db, userId, id).questions.every((q) => q.domain === "SE")).toBe(true);
  });

  test("draft questions never reach an exam", () => {
    seedCatalogAndBank(db, 3);
    db.update(questions).set({ status: "draft" }).where(sql`domain_id != 4`).run();
    const view = getSessionForTaking(db, userId, createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 20 }));
    expect(new Set(view.questions.map((q) => q.domain)).size).toBe(1);
  });

  test("refuses a domain session with no domain given", () => {
    seedCatalogAndBank(db, 3);
    expect(() => createSession(db, userId, { certificationCode: "CBAP", mode: "domain", total: 5 })).toThrow(
      /domain is required/i,
    );
  });

  test("refuses a domain that is not part of the certification's framework", () => {
    seedCatalogAndBank(db, 3);
    expect(() =>
      createSession(db, userId, { certificationCode: "CBAP", mode: "domain", domain: "UBA", total: 5 }),
    ).toThrow(/UBA/);
  });

  test("refuses a certification that does not exist", () => {
    seedCatalogAndBank(db, 3);
    expect(() => createSession(db, userId, { certificationCode: "PMP", mode: "quick" })).toThrow(/PMP/);
  });

  test("refuses to start a session for a certification with no eligible questions", () => {
    // ECBA examines a different framework, so the BABOK bank is invisible to it.
    seedCatalogAndBank(db, 5);
    expect(() => createSession(db, userId, { certificationCode: "ECBA", mode: "quick" })).toThrow(
      /no questions available/i,
    );
  });
});

describe("certification eligibility rules", () => {
  test("a certification only serves questions at or below its proficiency level", () => {
    seedCatalogAndBank(db, 0);
    importQuestionPack(db, sampleBank(4, { difficulty: 3 }));

    // CBAP examines at Level 3 — Expert; CCBA at Level 2 — Skilled.
    expect(getBankCoverage(db, cert("CBAP")).total).toBe(24);
    expect(getBankCoverage(db, cert("CCBA")).total).toBe(0);
  });

  test("a certification without case studies never serves case-bound questions", () => {
    seedCatalogAndBank(db, 0);
    const pack = sampleBank(2);
    pack.caseStudies = [{ code: "CS-1", title: "A case", body: "A long business situation." }];
    pack.questions[0].caseStudyCode = "CS-1";
    importQuestionPack(db, pack);

    // IIBA's handbooks: CBAP is case-study and scenario-based, CCBA scenario-based only.
    expect(getBankCoverage(db, cert("CBAP")).total).toBe(12);
    expect(getBankCoverage(db, cert("CCBA")).total).toBe(11);
  });

  test("a certification never sees questions from another framework", () => {
    seedCatalogAndBank(db, 5);
    expect(getBankCoverage(db, cert("ECBA")).total).toBe(0);
    expect(getBankCoverage(db, cert("CBAP")).total).toBe(30);
  });
});

describe("getSessionForTaking", () => {
  test("does not leak which option is correct", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    const serialised = JSON.stringify(getSessionForTaking(db, userId, id));

    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("rationale");
    expect(serialised).not.toContain("explanation");
  });

  test("renders the same option order every time the session is reopened", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    expect(getSessionForTaking(db, userId, id)).toEqual(getSessionForTaking(db, userId, id));
  });

  test("labels options A to D by their displayed position", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    expect(getSessionForTaking(db, userId, id).questions[0].options.map((o) => o.label)).toEqual([
      "A", "B", "C", "D",
    ]);
  });
});

describe("saveAnswer", () => {
  const start = () => createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });

  test("remembers the chosen option", () => {
    seedCatalogAndBank(db, 3);
    const id = start();
    const first = getSessionForTaking(db, userId, id).questions[0];
    saveAnswer(db, userId, id, first.questionId, { selectedOptionId: first.options[2].id });
    expect(getSessionForTaking(db, userId, id).questions[0].selectedOptionId).toBe(first.options[2].id);
  });

  test("remembers a flag independently of the answer", () => {
    seedCatalogAndBank(db, 3);
    const id = start();
    const first = getSessionForTaking(db, userId, id).questions[0];
    saveAnswer(db, userId, id, first.questionId, { flagged: true });

    const reloaded = getSessionForTaking(db, userId, id).questions[0];
    expect(reloaded.flagged).toBe(true);
    expect(reloaded.selectedOptionId).toBeNull();
  });

  test("rejects an option belonging to a different question", () => {
    seedCatalogAndBank(db, 3);
    const id = start();
    const [first, second] = getSessionForTaking(db, userId, id).questions;
    expect(() =>
      saveAnswer(db, userId, id, first.questionId, { selectedOptionId: second.options[0].id }),
    ).toThrow();
  });

  test("refuses to change an answer after the exam is submitted", () => {
    seedCatalogAndBank(db, 3);
    const id = start();
    const first = getSessionForTaking(db, userId, id).questions[0];
    submitSession(db, userId, id);
    expect(() =>
      saveAnswer(db, userId, id, first.questionId, { selectedOptionId: first.options[0].id }),
    ).toThrow(/submitted/i);
  });
});

describe("submitSession", () => {
  test("scores a perfect run", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 12 });
    answerAll(id, true);
    const score = submitSession(db, userId, id);
    expect(score.correct).toBe(12);
    expect(score.passed).toBe(true);
  });

  test("scores an all-wrong run", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 12 });
    answerAll(id, false);
    expect(submitSession(db, userId, id).passed).toBe(false);
  });

  test("counts skipped questions as unanswered", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 6 });
    expect(submitSession(db, userId, id).unanswered).toBe(6);
  });

  test("breaks the score down by the certification's own domains", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 12 });
    const score = submitSession(db, userId, id);
    expect(Object.keys(score.byDomain).sort()).toEqual(
      ["BAPM", "EC", "RADD", "RLCM", "SA", "SE"],
    );
  });

  test("cannot be submitted twice", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    submitSession(db, userId, id);
    expect(() => submitSession(db, userId, id)).toThrow(/already submitted/i);
  });
});

describe("getSessionResult", () => {
  test("reveals explanations and per-option reasoning after submission", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    answerAll(id, false);
    submitSession(db, userId, id);

    const result = getSessionResult(db, userId, id);
    expect(result.score.correct).toBe(0);
    expect(result.certification.code).toBe("CBAP");
    const q = result.questions[0];
    expect(q.explanation).toBeTruthy();
    expect(q.sourceRef).toMatch(/^\d+\.\d+/);
    expect(q.options.every((o) => o.rationale.length > 0)).toBe(true);
    expect(q.options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  test("is unavailable before submission", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    expect(() => getSessionResult(db, userId, id)).toThrow(/not been submitted/i);
  });
});

describe("loadReviewPool", () => {
  test("collects questions the learner got wrong", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 6 });
    answerAll(id, false);
    submitSession(db, userId, id);
    expect(loadReviewPool(db, userId, cert("CBAP"))).toHaveLength(6);
  });

  test("drops a question once it is answered correctly later", () => {
    seedCatalogAndBank(db, 2);
    const first = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 12 });
    answerAll(first, false);
    submitSession(db, userId, first);

    const second = createSession(db, userId, { certificationCode: "CBAP", mode: "review", total: 12 });
    answerAll(second, true);
    submitSession(db, userId, second);

    expect(loadReviewPool(db, userId, cert("CBAP"))).toHaveLength(0);
  });

  test("keeps bookmarked questions even when answered correctly", () => {
    seedCatalogAndBank(db, 2);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 12 });
    const view = getSessionForTaking(db, userId, id);
    db.insert(bookmarks).values({ questionId: view.questions[0].questionId, userId }).run();
    answerAll(id, true);
    submitSession(db, userId, id);

    expect(loadReviewPool(db, userId, cert("CBAP")).map((q) => q.id)).toEqual([
      view.questions[0].questionId,
    ]);
  });

  test("does not carry one certification's mistakes into another", () => {
    seedCatalogAndBank(db, 3);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 6 });
    answerAll(id, false);
    submitSession(db, userId, id);

    expect(loadReviewPool(db, userId, cert("CBAP")).length).toBe(6);
    expect(loadReviewPool(db, userId, cert("CCBA")).length).toBe(0);
  });

  test("is empty before anything has been answered", () => {
    seedCatalogAndBank(db, 3);
    expect(loadReviewPool(db, userId, cert("CBAP"))).toEqual([]);
  });
});

describe("per-user isolation", () => {
  test("a session belongs only to the user who created it", () => {
    seedCatalogAndBank(db, 5);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    const other = createTestUser(db, "other-user");
    expect(() => getSessionForTaking(db, other, id)).toThrow(/does not exist/);
  });

  test("bookmarks are private, so the review pool never crosses users", () => {
    seedCatalogAndBank(db, 6);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    const q = getSessionForTaking(db, userId, id).questions[0];
    toggleBookmark(db, userId, q.questionId);

    const other = createTestUser(db, "other-user");
    expect(loadReviewPool(db, other, cert("CBAP"))).toEqual([]);
    expect(loadReviewPool(db, userId, cert("CBAP")).map((p) => p.id)).toContain(q.questionId);
  });

  test("rejects a null userId when creating a session", () => {
    expect(() =>
      createSession(db, null, { certificationCode: "CBAP", mode: "quick", total: 5 }),
    ).toThrow(/userId/);
  });
});
