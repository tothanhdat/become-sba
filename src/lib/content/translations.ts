import { createHash } from "node:crypto";

import { inArray } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db";
import {
  caseStudies,
  caseStudyTranslationsVi,
  questionOptions,
  questionTranslationsVi,
  questions,
} from "@/lib/db/schema";
import { OPTION_LABELS, type OptionLabel } from "@/lib/domain";

/**
 * Wire format for the Vietnamese overlay files under content/translations/vi/.
 *
 * The overlay is keyed on question `code`, never on the database id: ids are
 * autoincrement and change whenever the bank is rebuilt from scratch.
 *
 * Loading these files fills the same cache tables the on-demand translator
 * writes to, so the "Dịch sang tiếng Việt" button works with no API key and no
 * network call. The route stays as the fallback for anything not pre-loaded.
 */

const translatedOptionSchema = z.object({
  label: z.enum(OPTION_LABELS),
  text: z.string().min(1),
  /** Optional so a file can be landed stem-first and finished later. */
  rationale: z.string().min(1).optional(),
});

const translatedQuestionSchema = z.object({
  code: z.string().regex(/^[A-Z]+-\d{3}$/, "code must look like RADD-001"),
  stem: z.string().min(1),
  options: z
    .array(translatedOptionSchema)
    .length(4)
    .refine((opts) => new Set(opts.map((o) => o.label)).size === 4, {
      message: "option labels must be A, B, C and D with no repeats",
    }),
  /** Optional so a file can be landed stem-first and finished later. */
  explanation: z.string().min(1).optional(),
  /** Hash of the English source this translation was written from. See `questionSourceHash`. */
  sourceHash: z.string().length(64),
});

const translatedCaseStudySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceHash: z.string().length(64),
});

export const translationPackSchema = z
  .object({
    version: z.literal(1),
    locale: z.literal("vi"),
    caseStudies: z.array(translatedCaseStudySchema).default([]),
    questions: z.array(translatedQuestionSchema),
  })
  .refine((p) => new Set(p.questions.map((q) => q.code)).size === p.questions.length, {
    message: "duplicate question code in translation file",
  });

export type TranslationPack = z.input<typeof translationPackSchema>;

export interface TranslationImportResult {
  questionsUpserted: number;
  caseStudiesUpserted: number;
  /**
   * Codes whose English source no longer hashes to what the translation was
   * written from. The translation is still loaded — a stale Vietnamese reading
   * beats none — but seed prints these so they can be redone.
   */
  stale: string[];
}

interface QuestionSource {
  stem: string;
  explanation: string;
  options: { label: OptionLabel; text: string; rationale: string }[];
}

/**
 * Fingerprint of the English content a translation was made from, so an edit to
 * the question bank surfaces the translations it invalidated instead of leaving
 * them silently wrong. Options are sorted by label: display order is not part
 * of the content.
 */
export function questionSourceHash(source: QuestionSource): string {
  const canonical = JSON.stringify({
    stem: source.stem,
    explanation: source.explanation,
    options: [...source.options]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((o) => [o.label, o.text, o.rationale]),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function caseStudySourceHash(source: { title: string; body: string }): string {
  const canonical = JSON.stringify({ title: source.title, body: source.body });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Load a Vietnamese overlay file into the translation cache, keyed on code.
 *
 * Idempotent: re-running seed overwrites each row, so correcting a translation
 * is a matter of editing the JSON and seeding again. A code the bank does not
 * have is a hard error rather than a skipped row — the overlay is generated
 * from the packs, so a miss means the two have drifted apart.
 */
export function importTranslationPack(db: Db, raw: TranslationPack): TranslationImportResult {
  const pack = translationPackSchema.parse(raw);

  const result: TranslationImportResult = {
    questionsUpserted: 0,
    caseStudiesUpserted: 0,
    stale: [],
  };

  const questionCodes = pack.questions.map((q) => q.code);
  const stored = questionCodes.length
    ? db
        .select({
          id: questions.id,
          code: questions.code,
          stem: questions.stem,
          explanation: questions.explanation,
        })
        .from(questions)
        .where(inArray(questions.code, questionCodes))
        .all()
    : [];
  const storedByCode = new Map(stored.map((q) => [q.code, q]));

  const missing = questionCodes.filter((code) => !storedByCode.has(code));
  if (missing.length > 0) {
    throw new Error(
      `Translation file names questions the bank does not have: ${missing.join(", ")}. ` +
        "Seed the question packs first, or fix the codes.",
    );
  }

  const englishOptions = new Map<number, { label: OptionLabel; text: string; rationale: string }[]>();
  /** `${questionId}:${label}` -> the option's row id, so the overlay can be stored keyed on identity. */
  const optionIdByQuestionAndLabel = new Map<string, number>();
  for (const row of db
    .select({
      id: questionOptions.id,
      questionId: questionOptions.questionId,
      label: questionOptions.label,
      text: questionOptions.text,
      rationale: questionOptions.rationale,
    })
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, stored.map((q) => q.id)))
    .all()) {
    const list = englishOptions.get(row.questionId) ?? [];
    list.push({ label: row.label, text: row.text, rationale: row.rationale });
    englishOptions.set(row.questionId, list);
    optionIdByQuestionAndLabel.set(`${row.questionId}:${row.label}`, row.id);
  }

  const caseCodes = pack.caseStudies.map((c) => c.code);
  const storedCases = caseCodes.length
    ? db
        .select({ id: caseStudies.id, code: caseStudies.code, title: caseStudies.title, body: caseStudies.body })
        .from(caseStudies)
        .where(inArray(caseStudies.code, caseCodes))
        .all()
    : [];
  const caseByCode = new Map(storedCases.map((c) => [c.code, c]));

  const missingCases = caseCodes.filter((code) => !caseByCode.has(code));
  if (missingCases.length > 0) {
    throw new Error(
      `Translation file names case studies the bank does not have: ${missingCases.join(", ")}.`,
    );
  }

  db.transaction((tx) => {
    for (const q of pack.questions) {
      const source = storedByCode.get(q.code)!;
      const current = questionSourceHash({
        stem: source.stem,
        explanation: source.explanation,
        options: englishOptions.get(source.id) ?? [],
      });
      if (current !== q.sourceHash) result.stale.push(q.code);

      // Each option carries its `question_options.id`: the exam screen re-letters
      // options per session, so the UI joins translations on identity, not label.
      const optionsJson = JSON.stringify(
        q.options.map((o) => {
          const id = optionIdByQuestionAndLabel.get(`${source.id}:${o.label}`);
          if (id === undefined) {
            throw new Error(
              `Translation for ${q.code} names option ${o.label}, which that question does not have.`,
            );
          }
          return o.rationale
            ? { id, label: o.label, text: o.text, rationale: o.rationale }
            : { id, label: o.label, text: o.text };
        }),
      );
      const explanation = q.explanation ?? null;
      tx.insert(questionTranslationsVi)
        .values({ questionId: source.id, stem: q.stem, optionsJson, explanation })
        .onConflictDoUpdate({
          target: questionTranslationsVi.questionId,
          set: { stem: q.stem, optionsJson, explanation },
        })
        .run();
      result.questionsUpserted += 1;
    }

    for (const cs of pack.caseStudies) {
      const source = caseByCode.get(cs.code)!;
      if (caseStudySourceHash(source) !== cs.sourceHash) result.stale.push(cs.code);

      tx.insert(caseStudyTranslationsVi)
        .values({ caseStudyId: source.id, title: cs.title, body: cs.body })
        .onConflictDoUpdate({
          target: caseStudyTranslationsVi.caseStudyId,
          set: { title: cs.title, body: cs.body },
        })
        .run();
      result.caseStudiesUpserted += 1;
    }
  });

  return result;
}
