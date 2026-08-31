import { and, asc, eq, lte, or, isNull, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { domains, flashcardReviews, flashcardStates, flashcards } from "@/lib/db/schema";
import { DECKS, REVIEW_GRADES, type Deck, type ReviewButton } from "@/lib/domain";
import { initialCardState, scheduleReview, type CardState } from "./sm2";

export interface DueCard {
  id: number;
  deck: Deck;
  front: string;
  back: string;
  domain: string | null;
  sourceRef: string | null;
  /** null for a card that has never been reviewed. */
  dueAt: number | null;
  repetitions: number;
}

export interface DueCardQuery {
  /**
   * Restrict to one framework's decks. Decks belong to a body of knowledge, so
   * CBAP and CCBA share the BABOK decks while ECBA sees none of them.
   */
  frameworkId?: number;
  deck?: Deck;
  limit?: number;
  now?: number;
}

/**
 * Cards ready to study: anything never reviewed, plus anything whose SM-2 due
 * date has arrived. Oldest due first, so the biggest backlog clears first.
 */
export function getDueCards(db: Db, query: DueCardQuery = {}): DueCard[] {
  const { frameworkId, deck, limit, now = Date.now() } = query;

  const rows = db
    .select({
      id: flashcards.id,
      deck: flashcards.deck,
      front: flashcards.front,
      back: flashcards.back,
      domain: domains.code,
      sourceRef: flashcards.sourceRef,
      dueAt: flashcardStates.dueAt,
      repetitions: flashcardStates.repetitions,
    })
    .from(flashcards)
    .leftJoin(flashcardStates, eq(flashcardStates.cardId, flashcards.id))
    .leftJoin(domains, eq(domains.id, flashcards.domainId))
    .where(
      and(
        frameworkId === undefined ? undefined : eq(flashcards.frameworkId, frameworkId),
        deck ? eq(flashcards.deck, deck) : undefined,
        or(isNull(flashcardStates.cardId), lte(flashcardStates.dueAt, now)),
      ),
    )
    .orderBy(asc(sql`coalesce(${flashcardStates.dueAt}, 0)`), asc(flashcards.id))
    .all();

  const due = rows.map((r) => ({ ...r, repetitions: r.repetitions ?? 0 }));
  return limit === undefined ? due : due.slice(0, limit);
}

function loadState(db: Db, cardId: number, now: number): CardState {
  const stored = db
    .select()
    .from(flashcardStates)
    .where(eq(flashcardStates.cardId, cardId))
    .get();

  if (!stored) return initialCardState(now);

  return {
    easeFactor: stored.easeFactor,
    intervalDays: stored.intervalDays,
    repetitions: stored.repetitions,
    lapses: stored.lapses,
    dueAt: stored.dueAt,
    lastReviewedAt: stored.lastReviewedAt,
  };
}

/**
 * Apply one review. The scheduling maths lives in sm2.ts; this only moves the
 * result into storage and appends to the review log.
 */
export function reviewCard(
  db: Db,
  cardId: number,
  button: ReviewButton,
  now: number = Date.now(),
): CardState {
  const card = db.select({ id: flashcards.id }).from(flashcards).where(eq(flashcards.id, cardId)).get();
  if (!card) throw new Error(`Flashcard ${cardId} does not exist`);

  const grade = REVIEW_GRADES[button];
  const next = scheduleReview(loadState(db, cardId, now), grade, now);

  db.transaction((tx) => {
    tx.insert(flashcardStates)
      .values({ cardId, ...next })
      .onConflictDoUpdate({ target: flashcardStates.cardId, set: next })
      .run();

    tx.insert(flashcardReviews)
      .values({ cardId, grade, intervalDaysAfter: next.intervalDays, reviewedAt: now })
      .run();
  });

  return next;
}

export interface DeckStats {
  total: number;
  /** Never reviewed. */
  new: number;
  /** Ready to study right now, including new cards. */
  due: number;
  /** Reviewed at least once. */
  learning: number;
}

export function getDeckStats(
  db: Db,
  frameworkId?: number,
  now: number = Date.now(),
): Record<Deck, DeckStats> {
  const stats = Object.fromEntries(
    DECKS.map((d) => [d, { total: 0, new: 0, due: 0, learning: 0 }]),
  ) as Record<Deck, DeckStats>;

  const rows = db
    .select({
      deck: flashcards.deck,
      dueAt: flashcardStates.dueAt,
    })
    .from(flashcards)
    .leftJoin(flashcardStates, eq(flashcardStates.cardId, flashcards.id))
    .where(frameworkId === undefined ? undefined : eq(flashcards.frameworkId, frameworkId))
    .all();

  for (const row of rows) {
    const s = stats[row.deck];
    s.total += 1;
    if (row.dueAt === null) {
      s.new += 1;
      s.due += 1;
    } else {
      s.learning += 1;
      if (row.dueAt <= now) s.due += 1;
    }
  }

  return stats;
}
