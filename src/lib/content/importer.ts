import { eq } from "drizzle-orm";

import { checkReference } from "@/lib/babok";
import type { Db } from "@/lib/db";
import { caseStudies, domains, flashcards, frameworks, questionOptions, questions } from "@/lib/db/schema";
import { deckSchema, questionPackSchema, type FlashcardDeck, type QuestionPack } from "./schema";

export type { FlashcardDeck, QuestionPack } from "./schema";

export interface RejectedQuestion {
  code: string;
  reason: string;
}

export interface ImportResult {
  questionsInserted: number;
  questionsUpdated: number;
  caseStudiesUpserted: number;
  /**
   * Questions held back as drafts because their BABOK citation did not check
   * out. They stay in the database so they can be corrected, but they never
   * reach an exam.
   */
  rejected: RejectedQuestion[];
}

/**
 * Load a question pack into the database, keyed on `question.code`.
 *
 * Idempotent by design: content lives in JSON under content/packs/, and seeding
 * runs over and over as the bank grows. The whole pack goes in one transaction,
 * so a pack that fails validation halfway leaves no partial import behind.
 */
export function importQuestionPack(db: Db, raw: QuestionPack): ImportResult {
  const pack = questionPackSchema.parse(raw);

  const framework = db
    .select({ id: frameworks.id })
    .from(frameworks)
    .where(eq(frameworks.code, pack.frameworkCode))
    .get();
  if (!framework) {
    throw new Error(
      `Pack targets framework ${pack.frameworkCode}, which is not in the catalog. Seed the catalog first.`,
    );
  }

  const domainIdByCode = new Map(
    db
      .select({ id: domains.id, code: domains.code })
      .from(domains)
      .where(eq(domains.frameworkId, framework.id))
      .all()
      .map((d) => [d.code, d.id]),
  );

  for (const q of pack.questions) {
    if (!domainIdByCode.has(q.domain)) {
      throw new Error(
        `Question ${q.code} is filed under domain ${q.domain}, which is not part of framework ${pack.frameworkCode}`,
      );
    }
  }

  const declaredCases = new Set(pack.caseStudies.map((c) => c.code));
  for (const q of pack.questions) {
    if (q.caseStudyCode && !declaredCases.has(q.caseStudyCode)) {
      throw new Error(
        `Question ${q.code} references case study ${q.caseStudyCode}, which the pack does not declare`,
      );
    }
  }

  const result: ImportResult = {
    questionsInserted: 0,
    questionsUpdated: 0,
    caseStudiesUpserted: 0,
    rejected: [],
  };

  db.transaction((tx) => {
    const caseIdByCode = new Map<string, number>();

    for (const cs of pack.caseStudies) {
      tx.insert(caseStudies)
        .values(cs)
        .onConflictDoUpdate({
          target: caseStudies.code,
          set: { title: cs.title, body: cs.body },
        })
        .run();

      const stored = tx
        .select({ id: caseStudies.id })
        .from(caseStudies)
        .where(eq(caseStudies.code, cs.code))
        .get();
      caseIdByCode.set(cs.code, stored!.id);
      result.caseStudiesUpserted += 1;
    }

    for (const q of pack.questions) {
      const existing = tx
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.code, q.code))
        .get();

      // The quality gate: a citation that does not resolve against the real
      // BABOK guide keeps the question out of exams, rather than shipping a
      // made-up reference to the learner.
      const problem = checkReference(pack.frameworkCode, q.sourceRef, q.sourceTask, q.domain);
      if (problem) result.rejected.push({ code: q.code, reason: problem });

      const row = {
        code: q.code,
        domainId: domainIdByCode.get(q.domain)!,
        sourceRef: q.sourceRef,
        sourceTask: q.sourceTask,
        difficulty: q.difficulty,
        caseStudyId: q.caseStudyCode ? caseIdByCode.get(q.caseStudyCode)! : null,
        stem: q.stem,
        explanation: q.explanation,
        status: problem ? ("draft" as const) : q.status,
      };

      let questionId: number;
      if (existing) {
        tx.update(questions).set(row).where(eq(questions.id, existing.id)).run();
        questionId = existing.id;
        result.questionsUpdated += 1;
      } else {
        const inserted = tx.insert(questions).values(row).returning({ id: questions.id }).get();
        questionId = inserted.id;
        result.questionsInserted += 1;
      }

      // Upsert on (question, label) rather than delete-and-reinsert: session
      // rows point at option ids, and a re-seed must not orphan them. The
      // schema pins every question to labels A-D, so no stale row can survive.
      for (const o of q.options) {
        tx.insert(questionOptions)
          .values({
            questionId,
            label: o.label,
            text: o.text,
            isCorrect: o.isCorrect,
            rationale: o.rationale,
          })
          .onConflictDoUpdate({
            target: [questionOptions.questionId, questionOptions.label],
            set: { text: o.text, isCorrect: o.isCorrect, rationale: o.rationale },
          })
          .run();
      }
    }
  });

  return result;
}

/** Same contract as importQuestionPack, keyed on `card.code`. */
export function importFlashcardDeck(db: Db, raw: FlashcardDeck): { inserted: number; updated: number } {
  const deck = deckSchema.parse(raw);

  const framework = db
    .select({ id: frameworks.id })
    .from(frameworks)
    .where(eq(frameworks.code, deck.frameworkCode))
    .get();
  if (!framework) {
    throw new Error(`Deck targets framework ${deck.frameworkCode}, which is not in the catalog`);
  }
  const domainIdByCode = new Map(
    db
      .select({ id: domains.id, code: domains.code })
      .from(domains)
      .where(eq(domains.frameworkId, framework.id))
      .all()
      .map((d) => [d.code, d.id]),
  );

  let inserted = 0;
  let updated = 0;

  db.transaction((tx) => {
    for (const card of deck.cards) {
      const existing = tx
        .select({ id: flashcards.id })
        .from(flashcards)
        .where(eq(flashcards.code, card.code))
        .get();

      const row = {
        code: card.code,
        frameworkId: framework.id,
        deck: deck.deck,
        front: card.front,
        back: card.back,
        domainId: card.domain ? (domainIdByCode.get(card.domain) ?? null) : null,
        sourceRef: card.sourceRef ?? null,
      };

      if (existing) {
        tx.update(flashcards).set(row).where(eq(flashcards.id, existing.id)).run();
        updated += 1;
      } else {
        tx.insert(flashcards).values(row).run();
        inserted += 1;
      }
    }
  });

  return { inserted, updated };
}
