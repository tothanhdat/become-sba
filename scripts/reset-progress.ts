/**
 * Wipe learning progress while keeping the question bank and decks.
 *
 * Use this after test runs, or to start a clean study cycle. To rebuild the
 * content itself, delete data/cbap.db and run `npm run seed`.
 */
import { db } from "../src/lib/db";
import {
  bookmarks,
  examSessions,
  flashcardReviews,
  flashcardStates,
  sessionQuestions,
  userNotes,
} from "../src/lib/db/schema";

db.delete(sessionQuestions).run();
db.delete(examSessions).run();
db.delete(flashcardReviews).run();
db.delete(flashcardStates).run();
db.delete(userNotes).run();
db.delete(bookmarks).run();

console.log("Progress cleared. Question bank and flashcard decks are untouched.");
