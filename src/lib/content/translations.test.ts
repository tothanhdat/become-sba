import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import { questionOptions, questionTranslationsVi, questions } from "@/lib/db/schema";
import { seedCatalogAndBank } from "@/test-support/bank";
import { translateQuestion } from "@/lib/translate";
import { importQuestionPack } from "./importer";
import {
  caseStudySourceHash,
  importTranslationPack,
  questionSourceHash,
  type TranslationPack,
} from "./translations";

let db: Db;

beforeEach(() => {
  db = createDatabase(":memory:");
  seedCatalogAndBank(db, 1);
});

const refuseToTranslate = () => {
  throw new Error("translator must not be called when a translation is pre-loaded");
};

function questionId(code: string): number {
  return db.select({ id: questions.id }).from(questions).where(eq(questions.code, code)).get()!.id;
}

/** The English source the sample bank generates for BAPM-001. */
const englishBapm001 = {
  stem: "Scenario BAPM-0: the analyst must decide what to do next on the programme.",
  explanation: "The BABOK guidance for BAPM explains the expected next step here.",
  options: (["A", "B", "C", "D"] as const).map((label) => ({
    label,
    text: `${label} option for BAPM-0`,
    rationale: `Reasoning for ${label}`,
  })),
};

function viPack(overrides: Partial<TranslationPack> = {}): TranslationPack {
  return {
    version: 1,
    locale: "vi",
    questions: [
      {
        code: "BAPM-001",
        stem: "Tình huống BAPM-0: analyst phải quyết định bước tiếp theo của programme.",
        options: [
          { label: "A", text: "Phương án A cho BAPM-0" },
          { label: "B", text: "Phương án B cho BAPM-0" },
          { label: "C", text: "Phương án C cho BAPM-0" },
          { label: "D", text: "Phương án D cho BAPM-0" },
        ],
        sourceHash: questionSourceHash(englishBapm001),
      },
    ],
    ...overrides,
  };
}

describe("importTranslationPack", () => {
  test("a pre-loaded translation is served without calling the translator", async () => {
    importTranslationPack(db, viPack());

    const translation = await translateQuestion(db, questionId("BAPM-001"), refuseToTranslate);

    expect(translation.stem).toBe("Tình huống BAPM-0: analyst phải quyết định bước tiếp theo của programme.");
    expect(translation.options.find((o) => o.label === "C")?.text).toBe("Phương án C cho BAPM-0");
  });

  test("each imported option carries its own question_options row id", async () => {
    importTranslationPack(db, viPack());

    const id = questionId("BAPM-001");
    const translation = await translateQuestion(db, id, refuseToTranslate);
    const english = db
      .select({ id: questionOptions.id, label: questionOptions.label })
      .from(questionOptions)
      .where(eq(questionOptions.questionId, id))
      .all();

    // Every translated option must point at the English row with the same label,
    // so the UI can join on id past the exam screen's per-session shuffle.
    for (const option of translation.options) {
      expect(option.id).toBe(english.find((o) => o.label === option.label)!.id);
    }
  });

  test("re-importing a revised file overwrites the stored translation", () => {
    importTranslationPack(db, viPack());

    const revised = viPack();
    revised.questions[0].stem = "Bản dịch đã sửa lại cho BAPM-0.";
    const second = importTranslationPack(db, revised);

    expect(second.questionsUpserted).toBe(1);
    const rows = db.select().from(questionTranslationsVi).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].stem).toBe("Bản dịch đã sửa lại cho BAPM-0.");
  });

  test("rejects a translation whose question code is not in the bank", () => {
    const pack = viPack();
    pack.questions[0].code = "BAPM-999";

    expect(() => importTranslationPack(db, pack)).toThrow(/BAPM-999/);
  });

  test("rejects a translation that is missing one of the four options", () => {
    const pack = viPack();
    pack.questions[0].options = pack.questions[0].options.slice(0, 3);

    expect(() => importTranslationPack(db, pack)).toThrow();
  });

  test("reports a translation whose English source has changed since it was written", () => {
    const pack = viPack();
    pack.questions[0].sourceHash = questionSourceHash({
      ...englishBapm001,
      stem: "An older version of this stem that no longer matches the bank.",
    });

    const result = importTranslationPack(db, pack);

    expect(result.stale).toEqual(["BAPM-001"]);
    expect(result.questionsUpserted).toBe(1);
  });

  test("loads the explanation and each option's rationale into the cache", async () => {
    const pack = viPack();
    pack.questions[0].explanation = "BABOK task 3.1 giải thích vì sao adaptive approach hợp với tình huống này.";
    pack.questions[0].options[0].rationale = "Đúng. Adaptive approach hợp khi nhu cầu chưa được hiểu rõ.";
    pack.questions[0].options[1].rationale = "Predictive approach hợp với mức bất định thấp.";

    importTranslationPack(db, pack);
    const translation = await translateQuestion(db, questionId("BAPM-001"), refuseToTranslate);

    expect(translation.explanation).toBe(
      "BABOK task 3.1 giải thích vì sao adaptive approach hợp với tình huống này.",
    );
    expect(translation.options.find((o) => o.label === "A")?.rationale).toBe(
      "Đúng. Adaptive approach hợp khi nhu cầu chưa được hiểu rõ.",
    );
    expect(translation.options.find((o) => o.label === "B")?.rationale).toBe(
      "Predictive approach hợp với mức bất định thấp.",
    );
  });

  test("a stem-only translation loads with no explanation or rationale", async () => {
    importTranslationPack(db, viPack());

    const translation = await translateQuestion(db, questionId("BAPM-001"), refuseToTranslate);

    expect(translation.explanation).toBeNull();
    expect(translation.options.find((o) => o.label === "A")?.rationale).toBeUndefined();
    expect(translation.options.find((o) => o.label === "A")?.text).toBe("Phương án A cho BAPM-0");
  });

  test("stores a case study translation alongside its questions", async () => {
    importQuestionPack(db, {
      version: 1,
      frameworkCode: "babok-v3",
      caseStudies: [{ code: "CS-01", title: "Claims platform", body: "A regional insurer replaces its claims platform." }],
      questions: [
        {
          code: "RADD-050",
          domain: "RADD",
          sourceRef: "7.1",
          sourceTask: "Specify and Model Requirements",
          difficulty: 2,
          status: "active",
          caseStudyCode: "CS-01",
          stem: "Given the case study, what should the business analyst model first?",
          explanation: "BABOK task 7.1 covers analysing and modelling requirements.",
          options: (["A", "B", "C", "D"] as const).map((label) => ({
            label,
            text: `${label} option for RADD-050`,
            rationale: `Reasoning for ${label}`,
            isCorrect: label === "A",
          })),
        },
      ],
    });

    importTranslationPack(db, {
      version: 1,
      locale: "vi",
      caseStudies: [
        {
          code: "CS-01",
          title: "Nền tảng claims",
          body: "Một công ty bảo hiểm khu vực thay thế nền tảng claims của mình.",
          sourceHash: caseStudySourceHash({
            title: "Claims platform",
            body: "A regional insurer replaces its claims platform.",
          }),
        },
      ],
      questions: [
        {
          code: "RADD-050",
          stem: "Với case study trên, business analyst nên model gì trước?",
          options: (["A", "B", "C", "D"] as const).map((label) => ({
            label,
            text: `Phương án ${label} cho RADD-050`,
          })),
          sourceHash: questionSourceHash({
            stem: "Given the case study, what should the business analyst model first?",
            explanation: "BABOK task 7.1 covers analysing and modelling requirements.",
            options: (["A", "B", "C", "D"] as const).map((label) => ({
              label,
              text: `${label} option for RADD-050`,
              rationale: `Reasoning for ${label}`,
            })),
          }),
        },
      ],
    });

    const translation = await translateQuestion(db, questionId("RADD-050"), refuseToTranslate);

    expect(translation.caseStudy?.title).toBe("Nền tảng claims");
    expect(translation.stem).toBe("Với case study trên, business analyst nên model gì trước?");
  });
});
