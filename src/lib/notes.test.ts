import { beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type Db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { importQuestionPack } from "@/lib/content/importer";
import { seedCatalogAndBank } from "@/test-support/bank";
import { getNote, isBookmarked, saveNote, toggleBookmark } from "./notes";

let db: Db;

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
});

describe("saveNote", () => {
  test("stores a note against a question", () => {
    const id = seedOneQuestion();
    saveNote(db, id, "Remember: elicitation results are unconfirmed.");
    expect(getNote(db, id)).toBe("Remember: elicitation results are unconfirmed.");
  });

  test("overwrites an existing note", () => {
    const id = seedOneQuestion();
    saveNote(db, id, "first");
    saveNote(db, id, "second");
    expect(getNote(db, id)).toBe("second");
  });

  test("clearing the text removes the note", () => {
    const id = seedOneQuestion();
    saveNote(db, id, "something");
    saveNote(db, id, "   ");
    expect(getNote(db, id)).toBeNull();
  });

  test("returns null when there is no note", () => {
    expect(getNote(db, seedOneQuestion())).toBeNull();
  });

  test("rejects a note on a question that does not exist", () => {
    expect(() => saveNote(db, 999, "orphan")).toThrow(/999/);
  });
});

describe("toggleBookmark", () => {
  test("adds a bookmark, then removes it", () => {
    const id = seedOneQuestion();
    expect(toggleBookmark(db, id)).toBe(true);
    expect(isBookmarked(db, id)).toBe(true);
    expect(toggleBookmark(db, id)).toBe(false);
    expect(isBookmarked(db, id)).toBe(false);
  });

  test("rejects a bookmark on a question that does not exist", () => {
    expect(() => toggleBookmark(db, 999)).toThrow(/999/);
  });
});
