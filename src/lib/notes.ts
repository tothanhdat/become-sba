import { and, eq } from "drizzle-orm";

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

function requireUserId(userId: string | null): string {
  if (userId === null) throw new Error("userId is required");
  return userId;
}

/** Store the learner's own note. Blank text deletes the note rather than storing "". */
export function saveNote(
  db: Db,
  userId: string | null,
  questionId: number,
  body: string,
  now = Date.now(),
): void {
  const owner = requireUserId(userId);
  assertQuestionExists(db, questionId);

  const trimmed = body.trim();
  if (trimmed === "") {
    db.delete(userNotes)
      .where(and(eq(userNotes.questionId, questionId), eq(userNotes.userId, owner)))
      .run();
    return;
  }

  db.insert(userNotes)
    .values({ questionId, userId: owner, body: trimmed, updatedAt: now })
    .onConflictDoUpdate({
      target: [userNotes.questionId, userNotes.userId],
      set: { body: trimmed, updatedAt: now },
    })
    .run();
}

export function getNote(db: Db, userId: string | null, questionId: number): string | null {
  const owner = requireUserId(userId);
  return (
    db
      .select({ body: userNotes.body })
      .from(userNotes)
      .where(and(eq(userNotes.questionId, questionId), eq(userNotes.userId, owner)))
      .get()?.body ?? null
  );
}

/** Flip the bookmark and return whether the question is now bookmarked. */
export function toggleBookmark(
  db: Db,
  userId: string | null,
  questionId: number,
  now = Date.now(),
): boolean {
  const owner = requireUserId(userId);
  assertQuestionExists(db, questionId);

  if (isBookmarked(db, owner, questionId)) {
    db.delete(bookmarks)
      .where(and(eq(bookmarks.questionId, questionId), eq(bookmarks.userId, owner)))
      .run();
    return false;
  }

  db.insert(bookmarks).values({ questionId, userId: owner, createdAt: now }).run();
  return true;
}

export function isBookmarked(db: Db, userId: string | null, questionId: number): boolean {
  const owner = requireUserId(userId);
  return (
    db
      .select({ questionId: bookmarks.questionId })
      .from(bookmarks)
      .where(and(eq(bookmarks.questionId, questionId), eq(bookmarks.userId, owner)))
      .get() !== undefined
  );
}
