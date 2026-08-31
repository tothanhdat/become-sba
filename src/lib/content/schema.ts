import { z } from "zod";

import { DECKS, OPTION_LABELS, QUESTION_STATUSES } from "@/lib/domain";

/**
 * Wire format for the JSON files under content/. These files are the source of
 * truth for the question bank; the database is a rebuildable projection of them.
 */

export const optionSchema = z.object({
  label: z.enum(OPTION_LABELS),
  text: z.string().min(1),
  /** Why this option is right, or why it is a near miss. Required either way. */
  rationale: z.string().min(1),
  isCorrect: z.boolean(),
});

export const packQuestionSchema = z.object({
  code: z.string().regex(/^[A-Z]+-\d{3}$/, "code must look like RADD-001"),
  /** Domain code within the pack's framework. */
  domain: z.string().min(1).max(12),
  /** Section within the source material, e.g. BABOK "7.1". */
  sourceRef: z.string().regex(/^\d+(\.\d+)*$/, "sourceRef must be a section number like 7.1"),
  sourceTask: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  caseStudyCode: z.string().optional(),
  stem: z.string().min(20),
  explanation: z.string().min(20),
  status: z.enum(QUESTION_STATUSES).default("draft"),
  options: z
    .array(optionSchema)
    .length(4)
    .refine((opts) => new Set(opts.map((o) => o.label)).size === 4, {
      message: "option labels must be A, B, C and D with no repeats",
    })
    .refine((opts) => opts.filter((o) => o.isCorrect).length === 1, {
      message: "a question must have exactly one correct option",
    }),
});

export const caseStudySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

export const questionPackSchema = z
  .object({
    version: z.literal(1),
    /** Which body of knowledge these questions are written against. */
    frameworkCode: z.string().min(1),
    caseStudies: z.array(caseStudySchema).default([]),
    questions: z.array(packQuestionSchema),
  })
  .refine(
    (pack) => new Set(pack.questions.map((q) => q.code)).size === pack.questions.length,
    { message: "duplicate question code in pack" },
  );

export const flashcardSchema = z.object({
  code: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  domain: z.string().min(1).max(12).optional(),
  sourceRef: z.string().optional(),
});

export const deckSchema = z
  .object({
    version: z.literal(1),
    /** Decks belong to a framework, so every certification on it shares them. */
    frameworkCode: z.string().min(1),
    deck: z.enum(DECKS),
    cards: z.array(flashcardSchema),
  })
  .refine((d) => new Set(d.cards.map((c) => c.code)).size === d.cards.length, {
    message: "duplicate card code in deck",
  });

export type QuestionPack = z.input<typeof questionPackSchema>;
export type ParsedQuestionPack = z.output<typeof questionPackSchema>;
export type FlashcardDeck = z.input<typeof deckSchema>;
