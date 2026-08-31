import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import type { OptionLabel } from "@/lib/domain";
import { seedCatalogAndBank } from "@/test-support/bank";
import { questionOptions, questions } from "@/lib/db/schema";
import { importQuestionPack, type QuestionPack } from "./importer";

let db: Db;

beforeEach(() => {
  db = createDatabase(":memory:");
  seedCatalogAndBank(db);
});

function option(label: OptionLabel, correct: boolean) {
  return {
    label,
    text: `Option ${label}`,
    isCorrect: correct,
    rationale: `Why ${label} is ${correct ? "right" : "wrong"}`,
  };
}

function pack(overrides: Partial<QuestionPack> = {}): QuestionPack {
  return {
    version: 1,
    frameworkCode: "babok-v3",
    questions: [
      {
        code: "RADD-001",
        domain: "RADD",
        sourceRef: "7.1",
        sourceTask: "Specify and Model Requirements",
        difficulty: 2,
        stem: "A business analyst is modelling requirements for a claims platform. What should they do next?",
        explanation: "BABOK task 7.1 covers analysing and modelling requirements.",
        options: [option("A", true), option("B", false), option("C", false), option("D", false)],
      },
    ],
    ...overrides,
  } as QuestionPack;
}

function storedQuestions(): { code: string }[] {
  return db.select({ code: questions.code }).from(questions).all();
}

describe("importQuestionPack", () => {
  test("stores a question with all four options", () => {
    const result = importQuestionPack(db, pack());

    expect(result.questionsInserted).toBe(1);
    const stored = db.select().from(questions).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].sourceRef).toBe("7.1");

    const options = db
      .select()
      .from(questionOptions)
      .where(eq(questionOptions.questionId, stored[0].id))
      .all();
    expect(options).toHaveLength(4);
    expect(options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  test("re-importing the same pack updates instead of duplicating", () => {
    importQuestionPack(db, pack());
    const second = importQuestionPack(db, pack());

    expect(second.questionsInserted).toBe(0);
    expect(second.questionsUpdated).toBe(1);
    expect(db.select().from(questions).all()).toHaveLength(1);
  });

  test("re-importing replaces the old options rather than appending", () => {
    importQuestionPack(db, pack());
    importQuestionPack(db, pack());
    expect(db.select().from(questionOptions).all()).toHaveLength(4);
  });

  test("keeps option ids stable so past answers survive a re-seed", () => {
    // Sessions store the chosen option id. Re-running the seed after an exam
    // must not invalidate those references.
    importQuestionPack(db, pack());
    const before = db.select().from(questionOptions).all().map((o) => o.id).sort();

    const edited = pack();
    edited.questions[0].options[1].text = "A reworded distractor";
    importQuestionPack(db, edited);

    const after = db.select().from(questionOptions).all();
    expect(after.map((o) => o.id).sort()).toEqual(before);
    expect(after.find((o) => o.label === "B")!.text).toBe("A reworded distractor");
  });

  test("an edited question overwrites the stored copy", () => {
    importQuestionPack(db, pack());
    const edited = pack();
    edited.questions[0].stem = "A revised stem for the same question code.";
    importQuestionPack(db, edited);

    const stored = db.select().from(questions).all();
    expect(stored[0].stem).toBe("A revised stem for the same question code.");
  });

  test("activates a question whose citation checks out", () => {
    const good = pack();
    good.questions[0].status = "active";
    importQuestionPack(db, good);
    expect(db.select().from(questions).all()[0].status).toBe("active");
  });

  test("holds back a question whose source reference does not exist", () => {
    const bad = pack();
    bad.questions[0].status = "active";
    bad.questions[0].sourceRef = "7.9";
    const result = importQuestionPack(db, bad);

    expect(db.select().from(questions).all()[0].status).toBe("draft");
    expect(result.rejected).toEqual([
      { code: "RADD-001", reason: expect.stringContaining("7.9") },
    ]);
  });

  test("holds back a question filed under the wrong knowledge area", () => {
    const bad = pack();
    bad.questions[0].status = "active";
    bad.questions[0].domain = "EC";
    const result = importQuestionPack(db, bad);

    expect(db.select().from(questions).all()[0].status).toBe("draft");
    expect(result.rejected[0].reason).toMatch(/RADD/);
  });

  test("holds back a question whose task name does not match its section", () => {
    const bad = pack();
    bad.questions[0].status = "active";
    bad.questions[0].sourceTask = "Prioritize Requirements";
    importQuestionPack(db, bad);
    expect(db.select().from(questions).all()[0].status).toBe("draft");
  });

  test("rejects a question with no correct option", () => {
    const bad = pack();
    bad.questions[0].options = [
      option("A", false),
      option("B", false),
      option("C", false),
      option("D", false),
    ];
    expect(() => importQuestionPack(db, bad)).toThrow(/exactly one correct/i);
  });

  test("rejects a question with two correct options", () => {
    const bad = pack();
    bad.questions[0].options = [
      option("A", true),
      option("B", true),
      option("C", false),
      option("D", false),
    ];
    expect(() => importQuestionPack(db, bad)).toThrow(/exactly one correct/i);
  });

  test("rejects duplicated option labels", () => {
    const bad = pack();
    bad.questions[0].options = [
      option("A", true),
      option("A", false),
      option("C", false),
      option("D", false),
    ];
    expect(() => importQuestionPack(db, bad)).toThrow();
  });

  test("rejects a domain outside the framework", () => {
    const bad = pack();
    bad.questions[0].domain = "NOPE";
    expect(() => importQuestionPack(db, bad)).toThrow();
  });

  test("rejects two questions sharing one code", () => {
    const bad = pack();
    bad.questions = [bad.questions[0], { ...bad.questions[0] }];
    expect(() => importQuestionPack(db, bad)).toThrow(/duplicate/i);
  });

  test("links questions to a case study declared in the same pack", () => {
    const withCase = pack({
      caseStudies: [{ code: "CS-01", title: "Claims platform", body: "A long scenario." }],
    });
    withCase.questions[0].caseStudyCode = "CS-01";

    importQuestionPack(db, withCase);
    const stored = db.select().from(questions).all();
    expect(stored[0].caseStudyId).not.toBeNull();
  });

  test("rejects a question pointing at a case study that does not exist", () => {
    const bad = pack();
    bad.questions[0].caseStudyCode = "CS-MISSING";
    expect(() => importQuestionPack(db, bad)).toThrow(/CS-MISSING/);
  });

  test("leaves nothing behind when a pack fails validation", () => {
    const bad = pack();
    bad.questions.push({ ...bad.questions[0], code: "RADD-002", domain: "NOPE" });
    expect(() => importQuestionPack(db, bad)).toThrow();
    expect(storedQuestions()).toHaveLength(0);
  });
});
