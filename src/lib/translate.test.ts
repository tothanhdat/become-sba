import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import { caseStudies, questionOptions, questions } from "@/lib/db/schema";
import { seedCatalogAndBank } from "@/test-support/bank";
import { importQuestionPack } from "@/lib/content/importer";
import { translateQuestion, type Translator } from "./translate";

let db: Db;

function seedQuestion(caseStudyCode?: string): number {
  seedCatalogAndBank(db);
  importQuestionPack(db, {
    version: 1,
    frameworkCode: "babok-v3",
    caseStudies: caseStudyCode
      ? [{ code: caseStudyCode, title: "Northbank", body: "Northbank is redesigning its loan process." }]
      : [],
    questions: [
      {
        code: "RADD-001",
        domain: "RADD",
        sourceRef: "7.1",
        sourceTask: "Specify and Model Requirements",
        stem: "A business analyst is modelling requirements. What should they do next?",
        explanation: "BABOK task 7.1 covers analysing and modelling requirements.",
        status: "active",
        caseStudyCode,
        options: (["A", "B", "C", "D"] as const).map((label) => ({
          label,
          text: `${label} option`,
          rationale: `Reasoning for ${label}`,
          isCorrect: label === "A",
        })),
      },
    ],
  });
  return db.select({ id: questions.id }).from(questions).all()[0].id;
}

const fakeTranslate: Translator = async ({ stem, options, caseStudy }) => ({
  stem: `[vi] ${stem}`,
  options: options.map((o) => ({ label: o.label, text: `[vi] ${o.text}` })),
  caseStudy: caseStudy ? { title: `[vi] ${caseStudy.title}`, body: `[vi] ${caseStudy.body}` } : null,
});

beforeEach(() => {
  db = createDatabase(":memory:");
});

describe("translateQuestion", () => {
  test("rejects a question that does not exist", async () => {
    await expect(translateQuestion(db, 999, fakeTranslate)).rejects.toThrow(/999/);
  });

  test("translates the stem and every option", async () => {
    const id = seedQuestion();
    const result = await translateQuestion(db, id, fakeTranslate);
    expect(result.stem).toBe("[vi] A business analyst is modelling requirements. What should they do next?");
    const stored = db
      .select({ id: questionOptions.id, label: questionOptions.label })
      .from(questionOptions)
      .where(eq(questionOptions.questionId, id))
      .orderBy(questionOptions.label)
      .all();
    expect(result.options).toEqual(
      stored.map((o) => ({ id: o.id, label: o.label, text: `[vi] ${o.label} option` })),
    );
    expect(result.caseStudy).toBeNull();
  });

  test("carries each option's own row id, so the UI can join past the display shuffle", async () => {
    const id = seedQuestion();
    const result = await translateQuestion(db, id, fakeTranslate);
    const storedIds = db
      .select({ id: questionOptions.id })
      .from(questionOptions)
      .where(eq(questionOptions.questionId, id))
      .all()
      .map((o) => o.id);
    expect(new Set(result.options.map((o) => o.id))).toEqual(new Set(storedIds));
  });

  test("attaches translated text by position, ignoring labels the translator invents", async () => {
    const id = seedQuestion();
    // A translator that returns the right texts in order but relabels them backwards.
    const relabelling: Translator = async ({ stem, options, caseStudy }) => ({
      stem: `[vi] ${stem}`,
      options: options.map((o, i) => ({
        label: (["D", "C", "B", "A"] as const)[i],
        text: `[vi] ${o.text}`,
      })),
      caseStudy: caseStudy ? { title: `[vi] ${caseStudy.title}`, body: `[vi] ${caseStudy.body}` } : null,
    });
    const result = await translateQuestion(db, id, relabelling);
    for (const option of result.options) {
      expect(option.text).toBe(`[vi] ${option.label} option`);
    }
  });

  test("caches the translation so a second call never invokes the translator again", async () => {
    const id = seedQuestion();
    const translate = vi.fn(fakeTranslate);
    const first = await translateQuestion(db, id, translate);
    const second = await translateQuestion(db, id, translate);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test("translates and caches the case study when the question has one", async () => {
    const id = seedQuestion("CS-RADD-01");
    const result = await translateQuestion(db, id, fakeTranslate);
    expect(result.caseStudy).toEqual({
      title: "[vi] Northbank",
      body: "[vi] Northbank is redesigning its loan process.",
    });
    const cached = db.select().from(caseStudies).all();
    expect(cached).toHaveLength(1);
  });

  test("rejects a translator result whose option labels do not match the question's own", async () => {
    const id = seedQuestion();
    const brokenTranslate: Translator = async () => ({
      stem: "[vi] stem",
      options: [{ label: "A", text: "only one option" }],
      caseStudy: null,
    });
    await expect(translateQuestion(db, id, brokenTranslate)).rejects.toThrow(/option/i);
  });
});
