import { eq } from "drizzle-orm";

import type { Db } from "./db";
import { caseStudies, caseStudyTranslationsVi, questionOptions, questionTranslationsVi, questions } from "./db/schema";
import type { OptionLabel } from "./domain";

export interface TranslatedOption {
  label: OptionLabel;
  text: string;
}

export interface TranslatedCaseStudy {
  title: string;
  body: string;
}

export interface QuestionTranslation {
  stem: string;
  options: TranslatedOption[];
  caseStudy: TranslatedCaseStudy | null;
}

/** What a translator receives: the original English content to translate. */
export interface TranslationInput {
  stem: string;
  options: { label: OptionLabel; text: string }[];
  caseStudy: TranslatedCaseStudy | null;
}

/** A function that turns English question content into Vietnamese. Swappable for tests. */
export type Translator = (input: TranslationInput) => Promise<QuestionTranslation>;

interface LoadedQuestion {
  stem: string;
  options: { label: OptionLabel; text: string }[];
  caseStudy: { id: number; title: string; body: string } | null;
}

function loadQuestion(db: Db, questionId: number): LoadedQuestion {
  const question = db
    .select({ stem: questions.stem, caseStudyId: questions.caseStudyId })
    .from(questions)
    .where(eq(questions.id, questionId))
    .get();
  if (!question) throw new Error(`Question ${questionId} does not exist`);

  const options = db
    .select({ label: questionOptions.label, text: questionOptions.text })
    .from(questionOptions)
    .where(eq(questionOptions.questionId, questionId))
    .all();

  const caseStudy = question.caseStudyId
    ? (db
        .select({ id: caseStudies.id, title: caseStudies.title, body: caseStudies.body })
        .from(caseStudies)
        .where(eq(caseStudies.id, question.caseStudyId))
        .get() ?? null)
    : null;

  return { stem: question.stem, options, caseStudy };
}

function readQuestionCache(db: Db, questionId: number): { stem: string; options: TranslatedOption[] } | null {
  const row = db
    .select({ stem: questionTranslationsVi.stem, optionsJson: questionTranslationsVi.optionsJson })
    .from(questionTranslationsVi)
    .where(eq(questionTranslationsVi.questionId, questionId))
    .get();
  if (!row) return null;
  return { stem: row.stem, options: JSON.parse(row.optionsJson) as TranslatedOption[] };
}

function readCaseStudyCache(db: Db, caseStudyId: number): TranslatedCaseStudy | null {
  const row = db
    .select({ title: caseStudyTranslationsVi.title, body: caseStudyTranslationsVi.body })
    .from(caseStudyTranslationsVi)
    .where(eq(caseStudyTranslationsVi.caseStudyId, caseStudyId))
    .get();
  return row ?? null;
}

function assertOptionsMatch(expected: { label: OptionLabel }[], actual: TranslatedOption[]): void {
  const expectedLabels = new Set(expected.map((o) => o.label));
  const actualLabels = new Set(actual.map((o) => o.label));
  const sameSize = expectedLabels.size === actualLabels.size;
  const sameMembers = [...expectedLabels].every((l) => actualLabels.has(l));
  if (!sameSize || !sameMembers) {
    throw new Error(
      `Translated option labels [${actual.map((o) => o.label).join(", ")}] do not match the question's own [${[...expectedLabels].join(", ")}]`,
    );
  }
}

/**
 * Return this question's Vietnamese translation, translating and caching it on
 * first request. Every learner shares the same cache, since the source
 * content is fixed — this is catalog data, not personal progress.
 */
export async function translateQuestion(db: Db, questionId: number, translate: Translator): Promise<QuestionTranslation> {
  const question = loadQuestion(db, questionId);

  const cachedQuestion = readQuestionCache(db, questionId);
  const cachedCaseStudy = question.caseStudy ? readCaseStudyCache(db, question.caseStudy.id) : null;

  if (cachedQuestion && (!question.caseStudy || cachedCaseStudy)) {
    return { stem: cachedQuestion.stem, options: cachedQuestion.options, caseStudy: cachedCaseStudy };
  }

  const result = await translate({
    stem: question.stem,
    options: question.options,
    caseStudy: question.caseStudy ? { title: question.caseStudy.title, body: question.caseStudy.body } : null,
  });
  assertOptionsMatch(question.options, result.options);

  db.insert(questionTranslationsVi)
    .values({ questionId, stem: result.stem, optionsJson: JSON.stringify(result.options) })
    .onConflictDoUpdate({
      target: questionTranslationsVi.questionId,
      set: { stem: result.stem, optionsJson: JSON.stringify(result.options) },
    })
    .run();

  if (question.caseStudy && result.caseStudy) {
    db.insert(caseStudyTranslationsVi)
      .values({ caseStudyId: question.caseStudy.id, title: result.caseStudy.title, body: result.caseStudy.body })
      .onConflictDoUpdate({
        target: caseStudyTranslationsVi.caseStudyId,
        set: { title: result.caseStudy.title, body: result.caseStudy.body },
      })
      .run();
  }

  return result;
}
