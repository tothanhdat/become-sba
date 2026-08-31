import { eq } from "drizzle-orm";

import type { Db } from "./db";
import { bookmarks, questions, userNotes } from "./db/schema";

function assertQuestionExists(db: Db, questionId: number): void {
  const found = db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.id, questionId))
    .get();
  if (!found) throw new Error(`Question ${questionId} does not exist`);
}

/** Store the learner's own note. Blank text deletes the note rather than storing "". */
export function saveNote(db: Db, questionId: number, body: string, now = Date.now()): void {
  assertQuestionExists(db, questionId);

  const trimmed = body.trim();
  if (trimmed === "") {
    db.delete(userNotes).where(eq(userNotes.questionId, questionId)).run();
    return;
  }

  db.insert(userNotes)
    .values({ questionId, body: trimmed, updatedAt: now })
    .onConflictDoUpdate({
      target: userNotes.questionId,
      set: { body: trimmed, updatedAt: now },
    })
    .run();
}

export function getNote(db: Db, questionId: number): string | null {
  return (
    db.select({ body: userNotes.body }).from(userNotes).where(eq(userNotes.questionId, questionId)).get()
      ?.body ?? null
  );
}

/** Flip the bookmark and return whether the question is now bookmarked. */
export function toggleBookmark(db: Db, questionId: number, now = Date.now()): boolean {
  assertQuestionExists(db, questionId);

  if (isBookmarked(db, questionId)) {
    db.delete(bookmarks).where(eq(bookmarks.questionId, questionId)).run();
    return false;
  }

  db.insert(bookmarks).values({ questionId, createdAt: now }).run();
  return true;
}

export function isBookmarked(db: Db, questionId: number): boolean {
  return (
    db.select({ questionId: bookmarks.questionId }).from(bookmarks).where(eq(bookmarks.questionId, questionId)).get() !==
    undefined
  );
}
