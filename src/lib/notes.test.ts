import { beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { importQuestionPack } from "@/lib/content/importer";
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
import { getNote, isBookmarked, saveNote, toggleBookmark } from "./notes";

let db: Db;
let userId: string;

function seedOneQuestion(): number {
  seedCatalogAndBank(db);
  importQuestionPack(db, {
    version: 1,
    frameworkCode: "babok-v3",
    questions: [
      {
        code: "RADD-001",
        domain: "RADD",
        sourceRef: "7.1",
        sourceTask: "Specify and Model Requirements",
        stem: "A business analyst is modelling requirements. What should they do next?",
        explanation: "BABOK task 7.1 covers analysing and modelling requirements.",
        status: "active",
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

beforeEach(() => {
  db = createDatabase(":memory:");
  userId = createTestUser(db);
});

describe("saveNote", () => {
  test("stores a note against a question", () => {
    const id = seedOneQuestion();
    saveNote(db, userId, id, "Remember: elicitation results are unconfirmed.");
    expect(getNote(db, userId, id)).toBe("Remember: elicitation results are unconfirmed.");
  });

  test("overwrites an existing note", () => {
    const id = seedOneQuestion();
    saveNote(db, userId, id, "first");
    saveNote(db, userId, id, "second");
    expect(getNote(db, userId, id)).toBe("second");
  });

  test("clearing the text removes the note", () => {
    const id = seedOneQuestion();
    saveNote(db, userId, id, "something");
    saveNote(db, userId, id, "   ");
    expect(getNote(db, userId, id)).toBeNull();
  });

  test("returns null when there is no note", () => {
    expect(getNote(db, userId, seedOneQuestion())).toBeNull();
  });

  test("rejects a note on a question that does not exist", () => {
    expect(() => saveNote(db, userId, 999, "orphan")).toThrow(/999/);
  });
});

describe("toggleBookmark", () => {
  test("adds a bookmark, then removes it", () => {
    const id = seedOneQuestion();
    expect(toggleBookmark(db, userId, id)).toBe(true);
    expect(isBookmarked(db, userId, id)).toBe(true);
    expect(toggleBookmark(db, userId, id)).toBe(false);
    expect(isBookmarked(db, userId, id)).toBe(false);
  });

  test("rejects a bookmark on a question that does not exist", () => {
    expect(() => toggleBookmark(db, userId, 999)).toThrow(/999/);
  });
});

describe("per-user isolation", () => {
  test("a note is private to the user who wrote it", () => {
    const id = seedOneQuestion();
    const other = createTestUser(db, "other-user");
    saveNote(db, userId, id, "mine");
    expect(getNote(db, other, id)).toBeNull();
    expect(getNote(db, userId, id)).toBe("mine");
  });

  test("a bookmark is private to the user who set it", () => {
    const id = seedOneQuestion();
    const other = createTestUser(db, "other-user");
    toggleBookmark(db, userId, id);
    expect(isBookmarked(db, other, id)).toBe(false);
    expect(isBookmarked(db, userId, id)).toBe(true);
  });

  test("rejects a null userId", () => {
    const id = seedOneQuestion();
    expect(() => saveNote(db, null, id, "x")).toThrow(/userId/);
  });
});
