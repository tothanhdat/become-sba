import { beforeEach, describe, expect, test } from "vitest";

import { importFlashcardDeck } from "@/lib/content/importer";
import { createDatabase, type Db } from "@/lib/db";
import { eq } from "drizzle-orm";

import { flashcardReviews, frameworks } from "@/lib/db/schema";
import type { Deck } from "@/lib/domain";
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
import { getDeckStats, getDueCards, reviewCard } from "./decks";
import { DAY_MS } from "./sm2";

const NOW = Date.UTC(2026, 0, 1);
let db: Db;
let userId: string;

function seedDeck(deck: Deck, count: number): void {
  importFlashcardDeck(db, {
    version: 1,
    frameworkCode: "babok-v3",
    deck,
    cards: Array.from({ length: count }, (_, i) => ({
      code: `${deck}-${i}`,
      front: `Front ${deck} ${i}`,
      back: `Back ${deck} ${i}`,
    })),
  });
}

beforeEach(() => {
  db = createDatabase(":memory:");
  seedCatalogAndBank(db);
  userId = createTestUser(db);
});

describe("getDueCards", () => {
  test("every card is due before it has ever been reviewed", () => {
    seedDeck("techniques", 5);
    expect(getDueCards(db, userId, { now: NOW })).toHaveLength(5);
  });

  test("a card graded good drops out of today's queue", () => {
    seedDeck("techniques", 2);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);
    expect(getDueCards(db, userId, { now: NOW }).map((c) => c.id)).not.toContain(card.id);
  });

  test("a card graded good comes back the next day", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);
    expect(getDueCards(db, userId, { now: NOW + DAY_MS }).map((c) => c.id)).toContain(card.id);
  });

  test("a forgotten card stays due in the same sitting", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "forgot", NOW);
    expect(getDueCards(db, userId, { now: NOW }).map((c) => c.id)).toContain(card.id);
  });

  test("filters to a single deck", () => {
    seedDeck("techniques", 3);
    seedDeck("glossary", 4);
    expect(getDueCards(db, userId, { deck: "glossary", now: NOW })).toHaveLength(4);
  });

  test("honours a limit", () => {
    seedDeck("techniques", 20);
    expect(getDueCards(db, userId, { limit: 5, now: NOW })).toHaveLength(5);
  });

  test("carries both sides of the card", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    expect(card.front).toBeTruthy();
    expect(card.back).toBeTruthy();
  });

  test("restricts to one framework's decks", () => {
    seedDeck("techniques", 3);
    const babok = db
      .select({ id: frameworks.id })
      .from(frameworks)
      .where(eq(frameworks.code, "babok-v3"))
      .get()!;
    const other = db
      .select({ id: frameworks.id })
      .from(frameworks)
      .where(eq(frameworks.code, "ba-standard"))
      .get()!;

    expect(getDueCards(db, userId, { frameworkId: babok.id, now: NOW })).toHaveLength(3);
    expect(getDueCards(db, userId, { frameworkId: other.id, now: NOW })).toHaveLength(0);
  });
});

describe("reviewCard", () => {
  test("advances the schedule through the SM-2 ladder", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });

    expect(reviewCard(db, userId, card.id, "good", NOW).intervalDays).toBe(1);
    expect(reviewCard(db, userId, card.id, "good", NOW + DAY_MS).intervalDays).toBe(6);
    expect(reviewCard(db, userId, card.id, "good", NOW + 7 * DAY_MS).intervalDays).toBe(15);
  });

  test("records every review in the log", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);
    reviewCard(db, userId, card.id, "forgot", NOW + DAY_MS);

    const log = db.select().from(flashcardReviews).all();
    expect(log).toHaveLength(2);
    expect(log.map((r) => r.grade)).toEqual([4, 2]);
  });

  test("counts lapses", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);
    expect(reviewCard(db, userId, card.id, "forgot", NOW + DAY_MS).lapses).toBe(1);
  });

  test("rejects an unknown card", () => {
    expect(() => reviewCard(db, userId, 999, "good", NOW)).toThrow(/999/);
  });
});

describe("getDeckStats", () => {
  test("reports totals, new cards and due cards per deck", () => {
    seedDeck("techniques", 5);
    seedDeck("tasks", 3);
    const [card] = getDueCards(db, userId, { deck: "techniques", now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);

    const stats = getDeckStats(db, userId, undefined, NOW);
    expect(stats.techniques).toEqual({ total: 5, new: 4, due: 4, learning: 1 });
    expect(stats.tasks).toEqual({ total: 3, new: 3, due: 3, learning: 0 });
  });

  test("reports zeros for a deck with no cards", () => {
    expect(getDeckStats(db, userId, undefined, NOW).glossary).toEqual({ total: 0, new: 0, due: 0, learning: 0 });
  });
});

describe("per-user isolation", () => {
  test("review progress is private to the user who graded the card", () => {
    seedDeck("techniques", 1);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);

    const other = createTestUser(db, "other-user");
    const otherDue = getDueCards(db, other, { now: NOW });
    expect(otherDue.map((c) => c.id)).toContain(card.id);
    expect(otherDue.find((c) => c.id === card.id)!.repetitions).toBe(0);
  });

  test("getDueCards returns an empty queue for a logged-out visitor", () => {
    seedDeck("techniques", 3);
    expect(getDueCards(db, null, { now: NOW })).toEqual([]);
  });

  test("getDeckStats reports real totals but zeroed progress when logged out", () => {
    seedDeck("techniques", 5);
    const [card] = getDueCards(db, userId, { now: NOW });
    reviewCard(db, userId, card.id, "good", NOW);

    const stats = getDeckStats(db, null, undefined, NOW);
    expect(stats.techniques).toEqual({ total: 5, new: 0, due: 0, learning: 0 });
  });
});
