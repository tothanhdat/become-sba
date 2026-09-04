import { eq } from "drizzle-orm";

import type { Db } from "./db";
import { caseStudies, caseStudyTranslationsVi, questionOptions, questionTranslationsVi, questions } from "./db/schema";
import type { OptionLabel } from "./domain";

export interface TranslatedOption {
  /**
   * The `question_options.id` this translation belongs to. The exam screen
   * re-letters options per session (see `shuffleForDisplay`), so the displayed
   * label is a position, not an identity — the UI must join English text to its
   * Vietnamese text on this id, never on the label.
   */
  id: number;
  /** The canonical label as stored in `question_options`, not the shuffled display letter. */
  label: OptionLabel;
  text: string;
  /** Present only for overlay-loaded translations; the on-demand translator omits it. */
  rationale?: string;
}

export interface TranslatedCaseStudy {
  title: string;
  body: string;
}

export interface QuestionTranslation {
  stem: string;
  options: TranslatedOption[];
  caseStudy: TranslatedCaseStudy | null;
  /** Null when the translation came from the on-demand translator. */
  explanation: string | null;
}

/** What a translator receives: the original English content to translate. */
export interface TranslationInput {
  stem: string;
  options: { label: OptionLabel; text: string }[];
  caseStudy: TranslatedCaseStudy | null;
}

/**
 * A function that turns English question content into Vietnamese. Swappable for tests.
 *
 * It covers only what the exam screen shows — stem, options, case study. The
 * explanation and per-option rationales are review-screen content and come from
 * the Vietnamese overlay files, so they are not part of this contract.
 */
export type Translator = (input: TranslationInput) => Promise<TranslatorResult>;

/**
 * What a translator returns. Deliberately carries no option `id`: identity is
 * re-attached from the question's own rows by index, so a translator can never
 * mis-assign a translation to the wrong option.
 */
export interface TranslatorResult {
  stem: string;
  options: { label: OptionLabel; text: string }[];
  caseStudy: TranslatedCaseStudy | null;
}

interface LoadedQuestion {
  stem: string;
  options: { id: number; label: OptionLabel; text: string }[];
  caseStudy: { id: number; title: string; body: string } | null;
}

function loadQuestion(db: Db, questionId: number): LoadedQuestion {
  const question = db
    .select({ stem: questions.stem, caseStudyId: questions.caseStudyId })
    .from(questions)
    .where(eq(questions.id, questionId))
    .get();
  if (!question) throw new Error(`Question ${questionId} does not exist`);

  // Ordered by label so the index-zip against the translator's reply below is
  // deterministic, matching `loadOptions` in exam/sessions.ts.
  const options = db
    .select({ id: questionOptions.id, label: questionOptions.label, text: questionOptions.text })
    .from(questionOptions)
    .where(eq(questionOptions.questionId, questionId))
    .orderBy(questionOptions.label)
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

function readQuestionCache(
  db: Db,
  questionId: number,
): { stem: string; options: TranslatedOption[]; explanation: string | null } | null {
  const row = db
    .select({
      stem: questionTranslationsVi.stem,
      optionsJson: questionTranslationsVi.optionsJson,
      explanation: questionTranslationsVi.explanation,
    })
    .from(questionTranslationsVi)
    .where(eq(questionTranslationsVi.questionId, questionId))
    .get();
  if (!row) return null;
  return {
    stem: row.stem,
    options: JSON.parse(row.optionsJson) as TranslatedOption[],
    explanation: row.explanation,
  };
}

function readCaseStudyCache(db: Db, caseStudyId: number): TranslatedCaseStudy | null {
  const row = db
    .select({ title: caseStudyTranslationsVi.title, body: caseStudyTranslationsVi.body })
    .from(caseStudyTranslationsVi)
    .where(eq(caseStudyTranslationsVi.caseStudyId, caseStudyId))
    .get();
  return row ?? null;
}

function assertOptionsMatch(expected: { label: OptionLabel }[], actual: { label: OptionLabel }[]): void {
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
    return {
      stem: cachedQuestion.stem,
      options: cachedQuestion.options,
      caseStudy: cachedCaseStudy,
      explanation: cachedQuestion.explanation,
    };
  }

  const result = await translate({
    stem: question.stem,
    options: question.options.map((o) => ({ label: o.label, text: o.text })),
    caseStudy: question.caseStudy ? { title: question.caseStudy.title, body: question.caseStudy.body } : null,
  });
  assertOptionsMatch(question.options, result.options);

  // Identity comes from the question's own rows, zipped by position; only the
  // `text` is taken from the translator. Its own labels are never trusted.
  const options: TranslatedOption[] = question.options.map((o, i) => ({
    id: o.id,
    label: o.label,
    text: result.options[i]?.text ?? o.text,
  }));
  const optionsJson = JSON.stringify(options);

  db.insert(questionTranslationsVi)
    .values({ questionId, stem: result.stem, optionsJson, explanation: null })
    .onConflictDoUpdate({
      target: questionTranslationsVi.questionId,
      set: { stem: result.stem, optionsJson, explanation: null },
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

  return { stem: result.stem, options, caseStudy: result.caseStudy, explanation: null };
}
