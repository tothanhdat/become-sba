# Google Auth + Per-User Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google sign-in (NextAuth.js / Auth.js v5) and scope every piece of learner progress (exam sessions, notes, bookmarks, flashcard SM-2 state) to the signed-in user, while keeping Dashboard/Library/the flashcard deck picker browsable without signing in.

**Architecture:** Auth.js v5 + `@auth/drizzle-adapter`, database session strategy, Google-only provider, backed by the same SQLite file as everything else. `userId` is threaded as the 2nd positional parameter (right after `db`) through every `lib/*` function that touches personal data — read functions accept `userId: string | null` and return an empty/zero result on `null`; functions with no sensible empty result (single-session/note/bookmark/card operations, and all writes) accept `userId: string | null` too but throw immediately if it's `null`, as a defensive check against the route/action layer's own gating. `getBankCoverage` (catalog eligibility, not personal data) is explicitly unchanged. No `middleware.ts` blanket gate — every route/Server Action/page gates itself.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM + better-sqlite3, `next-auth@beta` (Auth.js v5), `@auth/drizzle-adapter`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-google-auth-per-user-progress-design.md`

## Global Constraints

- Google OAuth only, no other providers. Credentials already live in `.env.local` as `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL=http://localhost:3000` — Auth.js v5 picks up `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` for the Google provider by convention, no explicit `clientId`/`clientSecret` wiring needed.
- Session strategy is **database**, not JWT.
- `userId` is never accepted from client input. Every mutating API route and Server Action calls `auth()` server-side and uses `session.user.id`.
- Every function signature in this plan places `userId` as the parameter immediately after `db`. Do not deviate — later tasks and the mechanical `sed` steps in this plan depend on that exact position.
- "Session belongs to someone else" and "session doesn't exist" must produce the identical result (same thrown error, same HTTP status, same UI) — never leak existence via a 403.
- No `middleware.ts`. No admin view, no leaderboard, no cross-user comparison.
- `getBankCoverage(db, cert)` keeps its current signature — catalog eligibility is not personal data.

---

### Task 1: Schema — auth tables, `userId` columns, migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `users`, `accounts`, `sessions`, `verificationTokens` Drizzle tables (shape required by `@auth/drizzle-adapter`); `userId: text` column added to `examSessions`, `userNotes`, `bookmarks`, `flashcardStates`, `flashcardReviews`; `userNotes`/`bookmarks`/`flashcardStates` primary keys become composite `(questionId/cardId, userId)`.

- [ ] **Step 1: Install the auth dependencies**

```bash
npm install next-auth@beta @auth/drizzle-adapter
```

- [ ] **Step 2: Replace the outdated top-of-file comment in `schema.ts`**

Find (around line 20):
```ts
/**
 * Single-learner app: there is no users table and no auth. If this ever becomes
 * multi-user, every table below gains a `userId` column and nothing else changes.
 *
 * Timestamps are unix milliseconds so they sort and diff without parsing.
 */
```

Replace with:
```ts
/**
 * Multi-user app: every table that carries personal progress has a `userId`
 * column referencing `users.id`, `onDelete: "cascade"` (deleting a user drops
 * their data). `users`/`accounts`/`sessions`/`verificationTokens` below are
 * Auth.js's own tables — `sessions` here is a session *cookie*, a different
 * concept from this app's own `exam_sessions` (a mock exam attempt).
 *
 * Timestamps are unix milliseconds so they sort and diff without parsing.
 */
```

- [ ] **Step 3: Add `primaryKey` to the sqlite-core import**

Find:
```ts
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
```

Replace with:
```ts
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
```

- [ ] **Step 4: Add the Auth.js tables**

Insert immediately after the `const now = sql\`(unixepoch() * 1000)\`;` line and before `export const frameworks = ...`:

```ts
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
```

- [ ] **Step 5: Add `userId` to `examSessions`**

Find (in the `examSessions` table definition):
```ts
export const examSessions = sqliteTable("exam_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  certificationId: integer("certification_id")
    .notNull()
    .references(() => certifications.id),
  mode: text("mode").$type<ExamMode>().notNull(),
```

Replace with:
```ts
export const examSessions = sqliteTable("exam_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  certificationId: integer("certification_id")
    .notNull()
    .references(() => certifications.id),
  mode: text("mode").$type<ExamMode>().notNull(),
```

- [ ] **Step 6: Give `userNotes` and `bookmarks` a composite primary key**

Find:
```ts
export const userNotes = sqliteTable("user_notes", {
  questionId: integer("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const bookmarks = sqliteTable("bookmarks", {
  questionId: integer("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(now),
});
```

Replace with:
```ts
export const userNotes = sqliteTable(
  "user_notes",
  {
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);
```

- [ ] **Step 7: Give `flashcardStates` a composite primary key and add `userId` to `flashcardReviews`**

Find:
```ts
export const flashcardStates = sqliteTable(
  "flashcard_states",
  {
    cardId: integer("card_id")
      .primaryKey()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    easeFactor: real("ease_factor").notNull().default(2.5),
```

Replace with:
```ts
export const flashcardStates = sqliteTable(
  "flashcard_states",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    easeFactor: real("ease_factor").notNull().default(2.5),
```

Find (a few lines below, the table's index/constraint list):
```ts
  (t) => [index("flashcard_states_due_idx").on(t.dueAt)],
);
```

Replace with:
```ts
  (t) => [
    primaryKey({ columns: [t.cardId, t.userId] }),
    index("flashcard_states_due_idx").on(t.dueAt),
  ],
);
```

Find:
```ts
/** Append-only log, so progress charts can be rebuilt later. */
export const flashcardReviews = sqliteTable("flashcard_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id")
    .notNull()
    .references(() => flashcards.id, { onDelete: "cascade" }),
  grade: integer("grade").notNull(),
```

Replace with:
```ts
/** Append-only log, so progress charts can be rebuilt later. */
export const flashcardReviews = sqliteTable("flashcard_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id")
    .notNull()
    .references(() => flashcards.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  grade: integer("grade").notNull(),
```

- [ ] **Step 8: Rebuild the local database from the new schema**

The five tables gaining `userId` are already empty (`npm run reset` was run earlier in this project), so the safest, simplest path is to regenerate the migration and rebuild the local SQLite file from scratch rather than hand-write an ALTER/backfill migration for data that doesn't exist yet:

```bash
rm -f data/cbap.db data/cbap.db-shm data/cbap.db-wal
npm run db:generate
npm run seed
```

`npm run seed` opens `data/cbap.db` (which runs the new migration automatically via `createDatabase`'s `migrate()` call) and reseeds the catalog/content packs.

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

Expected: fails — every caller of `createSession`, `saveAnswer`, `submitSession`, `getSessionResult`, `getSessionForTaking`, `loadReviewPool`, `saveNote`, `getNote`, `toggleBookmark`, `isBookmarked`, `reviewCard`, `getDueCards`, `getDeckStats`, `getReadiness`, `getSessionHistory` is about to gain a new required argument. That's expected — subsequent tasks fix each call site. This step exists only to confirm the schema itself compiles cleanly (no schema-level TS errors) before moving on; ignore call-site errors from other files for now.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/schema.ts package.json package-lock.json drizzle/
git commit -m "feat(db): add Auth.js tables and userId columns for per-user progress"
```

---

### Task 2: NextAuth config + route handler

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/types/next-auth.d.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` exported from `@/lib/auth`. `auth()` returns `Promise<{ user: { id: string; name?: string | null; email?: string | null; image?: string | null } } | null>` — every later task that calls `auth()` relies on `session.user.id` being a `string`. This requires both the `session` callback (Step 1) and the type augmentation (Step 2) — Auth.js v5 does not populate or type `session.user.id` on its own.

- [ ] **Step 1: Write `src/lib/auth.ts`**

Auth.js v5 does **not** put `id` on `session.user` by default, even with the database session strategy — the adapter's `user` object (passed into the `session` callback) has `.id`, but nothing copies it onto `session.user.id` unless a `session` callback does it explicitly. Every later task in this plan reads `session.user.id`, so this callback is required here, not optional:

```ts
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { db, schema } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [Google],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
```

- [ ] **Step 2: Add the `session.user.id` type augmentation**

Without this, `session.user.id` is a TypeScript error everywhere it's read (Tasks 9, 10, 13, 14, 15 all read it) — `npx vitest run` would still pass since Vitest doesn't type-check, but `npm run typecheck` / `npm run build` would fail. Create:

```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
```

Save this as `src/types/next-auth.d.ts`.

- [ ] **Step 3: Write the route handler**

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Visit `http://localhost:3000/api/auth/signin` in a browser — Auth.js's built-in sign-in page should render with a "Sign in with Google" button (only one provider is configured, so it's the only option shown). Click it, complete the Google consent screen, and confirm you land back on the app without an error.

Then visit `http://localhost:3000/api/auth/session` in the same browser session. This returns the current session as JSON — confirm the response includes `user.id` as a non-empty string (not just `name`/`email`/`image`). This is the one thing that cannot be caught by typecheck or tests: it's Auth.js's actual runtime behavior. If `id` is missing, the `session` callback in Step 1 isn't wired correctly — fix it before moving on, since every later task depends on `session.user.id` being real. Stop the dev server once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/types/next-auth.d.ts src/app/api/auth/
git commit -m "feat(auth): add Auth.js v5 config with Google provider and database sessions"
```

---

### Task 3: Test helper — `createTestUser`

**Files:**
- Modify: `src/test-support/bank.ts`

**Interfaces:**
- Produces: `export const TEST_USER_ID = "test-user-1"`, `export function createTestUser(db: Db, id: string = TEST_USER_ID): string`. Every later test-file task imports both from `@/test-support/bank`.

- [ ] **Step 1: Add the import and helper**

Find:
```ts
import { BABOK_TASKS } from "@/lib/babok";
import { importCatalog, type CertificationPack, type FrameworkPack } from "@/lib/catalog";
import { importQuestionPack } from "@/lib/content/importer";
import type { QuestionPack } from "@/lib/content/schema";
import type { Db } from "@/lib/db";
import { OPTION_LABELS, type Difficulty } from "@/lib/domain";
```

Replace with:
```ts
import { BABOK_TASKS } from "@/lib/babok";
import { importCatalog, type CertificationPack, type FrameworkPack } from "@/lib/catalog";
import { importQuestionPack } from "@/lib/content/importer";
import type { QuestionPack } from "@/lib/content/schema";
import type { Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { OPTION_LABELS, type Difficulty } from "@/lib/domain";

export const TEST_USER_ID = "test-user-1";

/** Inserts a minimal user row so userId-scoped foreign keys resolve in tests. */
export function createTestUser(db: Db, id: string = TEST_USER_ID): string {
  db.insert(users).values({ id, email: `${id}@example.test` }).run();
  return id;
}
```

- [ ] **Step 2: Typecheck just this file's dependents compile**

```bash
npx tsc --noEmit -p . 2>&1 | grep "test-support/bank.ts" || echo "no errors in bank.ts"
```

Expected: `no errors in bank.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/test-support/bank.ts
git commit -m "test: add createTestUser helper for per-user fixtures"
```

---

### Task 4: `notes.ts` — thread `userId`

**Files:**
- Modify: `src/lib/notes.ts`
- Modify: `src/lib/notes.test.ts`

**Interfaces:**
- Consumes: `createTestUser`, `TEST_USER_ID` from `@/test-support/bank` (Task 3).
- Produces: `saveNote(db, userId, questionId, body, now?)`, `getNote(db, userId, questionId)`, `toggleBookmark(db, userId, questionId, now?)`, `isBookmarked(db, userId, questionId)`. All four throw `"userId is required"` when `userId` is `null`.

- [ ] **Step 1: Rewrite `src/lib/notes.ts`**

```ts
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
```

- [ ] **Step 2: Update the import line in `notes.test.ts`**

Find:
```ts
import { seedCatalogAndBank } from "@/test-support/bank";
```

Replace with:
```ts
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
```

- [ ] **Step 3: Add `userId` state and mechanically thread it through every call**

Find:
```ts
let db: Db;
```

Replace with:
```ts
let db: Db;
let userId: string;
```

Find:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
});
```

Replace with:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
  userId = createTestUser(db);
});
```

Then run this from the repo root — every call to the four functions has the exact literal form `fn(db, ` at the start of its argument list, so inserting `userId, ` right after `db, ` is a safe, mechanical, nesting-proof edit (this project's dev machine is macOS, hence BSD `sed -i ''`):

```bash
sed -i '' \
  -e 's/saveNote(db, /saveNote(db, userId, /g' \
  -e 's/getNote(db, /getNote(db, userId, /g' \
  -e 's/toggleBookmark(db, /toggleBookmark(db, userId, /g' \
  -e 's/isBookmarked(db, /isBookmarked(db, userId, /g' \
  src/lib/notes.test.ts
```

- [ ] **Step 4: Add per-user isolation coverage**

Append a new `describe` block at the end of `src/lib/notes.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/lib/notes.test.ts
```

Expected: all tests pass, including the three new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notes.ts src/lib/notes.test.ts
git commit -m "feat(notes): scope notes and bookmarks to the signed-in user"
```

---

### Task 5: `srs/decks.ts` — thread `userId`

**Files:**
- Modify: `src/lib/srs/decks.ts`
- Modify: `src/lib/srs/decks.test.ts`

**Interfaces:**
- Consumes: `createTestUser` from `@/test-support/bank` (Task 3).
- Produces: `getDueCards(db, userId, query?)` (returns `[]` when `userId` is `null`), `reviewCard(db, userId, cardId, button, now?)` (throws when `userId` is `null`), `getDeckStats(db, userId, frameworkId?, now?)` (total counts are always real; `new`/`due`/`learning` are `0` when `userId` is `null`).

- [ ] **Step 1: Rewrite `src/lib/srs/decks.ts`**

```ts
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

function requireUserId(userId: string | null): string {
  if (userId === null) throw new Error("userId is required");
  return userId;
}

/**
 * Cards ready to study: anything never reviewed, plus anything whose SM-2 due
 * date has arrived. Oldest due first, so the biggest backlog clears first.
 *
 * `userId` is `null` for a logged-out visitor, who has no SM-2 state at all —
 * there is nothing "due" without an account, so this returns an empty queue
 * rather than touching the database.
 */
export function getDueCards(db: Db, userId: string | null, query: DueCardQuery = {}): DueCard[] {
  if (userId === null) return [];
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
    .leftJoin(
      flashcardStates,
      and(eq(flashcardStates.cardId, flashcards.id), eq(flashcardStates.userId, userId)),
    )
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

function loadState(db: Db, cardId: number, userId: string, now: number): CardState {
  const stored = db
    .select()
    .from(flashcardStates)
    .where(and(eq(flashcardStates.cardId, cardId), eq(flashcardStates.userId, userId)))
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
  userId: string | null,
  cardId: number,
  button: ReviewButton,
  now: number = Date.now(),
): CardState {
  const owner = requireUserId(userId);
  const card = db.select({ id: flashcards.id }).from(flashcards).where(eq(flashcards.id, cardId)).get();
  if (!card) throw new Error(`Flashcard ${cardId} does not exist`);

  const grade = REVIEW_GRADES[button];
  const next = scheduleReview(loadState(db, cardId, owner, now), grade, now);

  db.transaction((tx) => {
    tx.insert(flashcardStates)
      .values({ cardId, userId: owner, ...next })
      .onConflictDoUpdate({ target: [flashcardStates.cardId, flashcardStates.userId], set: next })
      .run();

    tx.insert(flashcardReviews)
      .values({ cardId, userId: owner, grade, intervalDaysAfter: next.intervalDays, reviewedAt: now })
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

/**
 * `total` is a property of the deck, not the visitor, so it's always real.
 * `new`/`due`/`learning` reflect SM-2 state, which only exists per-user — a
 * logged-out visitor gets zeros there rather than a misleading count.
 */
export function getDeckStats(
  db: Db,
  userId: string | null,
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
    .leftJoin(
      flashcardStates,
      and(
        eq(flashcardStates.cardId, flashcards.id),
        userId === null ? sql`1 = 0` : eq(flashcardStates.userId, userId),
      ),
    )
    .where(frameworkId === undefined ? undefined : eq(flashcards.frameworkId, frameworkId))
    .all();

  for (const row of rows) {
    const s = stats[row.deck];
    s.total += 1;
    if (userId === null) continue;
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
```

- [ ] **Step 2: Update the import line in `decks.test.ts`**

Find:
```ts
import { seedCatalogAndBank } from "@/test-support/bank";
```

Replace with:
```ts
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
```

- [ ] **Step 3: Add `userId` state and mechanically thread it through every call**

Find:
```ts
const NOW = Date.UTC(2026, 0, 1);
let db: Db;
```

Replace with:
```ts
const NOW = Date.UTC(2026, 0, 1);
let db: Db;
let userId: string;
```

Find:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
  seedCatalogAndBank(db);
});
```

Replace with:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
  seedCatalogAndBank(db);
  userId = createTestUser(db);
});
```

```bash
sed -i '' \
  -e 's/getDueCards(db, /getDueCards(db, userId, /g' \
  -e 's/reviewCard(db, /reviewCard(db, userId, /g' \
  -e 's/getDeckStats(db, /getDeckStats(db, userId, /g' \
  src/lib/srs/decks.test.ts
```

- [ ] **Step 4: Add per-user isolation coverage**

Append at the end of `src/lib/srs/decks.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/lib/srs/decks.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/srs/decks.ts src/lib/srs/decks.test.ts
git commit -m "feat(srs): scope flashcard review state to the signed-in user"
```

---

### Task 6: `exam/sessions.ts` — thread `userId`, add ownership check

**Files:**
- Modify: `src/lib/exam/sessions.ts`
- Modify: `src/lib/exam/sessions.test.ts`

**Interfaces:**
- Consumes: `createTestUser` from `@/test-support/bank` (Task 3), `toggleBookmark` from `@/lib/notes` (Task 4).
- Produces: `createSession(db, userId, options)`, `getSessionForTaking(db, userId, sessionId)`, `saveAnswer(db, userId, sessionId, questionId, patch, now?)`, `submitSession(db, userId, sessionId, now?)`, `getSessionResult(db, userId, sessionId)`, `loadReviewPool(db, userId, cert)` (returns `[]` when `userId` is `null`). `getBankCoverage(db, cert)` is **unchanged**.

- [ ] **Step 1: Rewrite `src/lib/exam/sessions.ts`**

```ts
import { and, eq, inArray, isNotNull, lte, max, or, isNull, sql } from "drizzle-orm";

import { getCertification, getCertificationById, type Certification } from "@/lib/catalog";
import type { Db } from "@/lib/db";
import {
  bookmarks,
  caseStudies,
  domains,
  examSessions,
  questionOptions,
  questions,
  sessionQuestions,
} from "@/lib/db/schema";
import { OPTION_LABELS, type ExamMode, type OptionLabel } from "@/lib/domain";
import { buildSessionPlan, type PoolQuestion } from "./generator";
import { seededShuffle } from "./rng";
import { scoreSession, type ScoreResult } from "./scoring";

/** How many questions each practice mode serves unless the caller says otherwise. */
const PRACTICE_TOTALS = { domain: 20, quick: 15, review: 20 } as const;

export interface CreateSessionOptions {
  certificationCode: string;
  mode: ExamMode;
  /** Domain code, required for mode "domain". */
  domain?: string;
  total?: number;
  /** Injectable for tests; defaults to a random seed. */
  seed?: number;
  now?: number;
}

function requireUserId(userId: string | null): string {
  if (userId === null) throw new Error("userId is required");
  return userId;
}

/**
 * Whether a question may be served for a certification.
 *
 * This is the rule that keeps the app honest across certifications rather than
 * just reweighting one bank. A CBAP question written at expert level, or bound
 * to a case study, is not a CCBA question: IIBA examines CCBA at Level 2 —
 * Skilled, and its handbook describes the paper as scenario-based with no
 * case studies.
 */
function eligibilityFilter(cert: Certification) {
  return and(
    eq(questions.status, "active"),
    eq(domains.frameworkId, cert.framework.id),
    lte(questions.difficulty, cert.proficiencyLevel),
    cert.allowsCaseStudies ? undefined : isNull(questions.caseStudyId),
  );
}

/**
 * Every question this certification may serve, tagged with when the learner
 * last saw it so the generator can favour unseen material.
 *
 * `userId` scopes the "last seen" lookup to one learner's own exam history.
 * `getBankCoverage` calls this with `userId` omitted — it only counts pool
 * size and never reads `lastSeenAt`, so it's fine for that scoping to be
 * absent there.
 */
function loadPool(db: Db, cert: Certification, restrictTo?: string, userId?: string): PoolQuestion[] {
  const lastSeen = db
    .select({
      questionId: sessionQuestions.questionId,
      lastSeenAt: max(examSessions.startedAt).as("last_seen_at"),
    })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .where(
      userId === undefined
        ? eq(examSessions.certificationId, cert.id)
        : and(eq(examSessions.certificationId, cert.id), eq(examSessions.userId, userId)),
    )
    .groupBy(sessionQuestions.questionId)
    .as("last_seen");

  const rows = db
    .select({
      id: questions.id,
      domain: domains.code,
      caseStudyId: questions.caseStudyId,
      lastSeenAt: lastSeen.lastSeenAt,
    })
    .from(questions)
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(lastSeen, eq(lastSeen.questionId, questions.id))
    .where(
      restrictTo
        ? and(eligibilityFilter(cert), eq(domains.code, restrictTo))
        : eligibilityFilter(cert),
    )
    .all();

  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    caseStudyId: r.caseStudyId,
    lastSeenAt: r.lastSeenAt ?? null,
  }));
}

/** How many questions this certification can currently serve, per domain. Not personal data — unscoped by user. */
export function getBankCoverage(
  db: Db,
  cert: Certification,
): { total: number; byDomain: Record<string, number> } {
  const pool = loadPool(db, cert);
  const byDomain = Object.fromEntries(cert.domains.map((d) => [d.code, 0]));
  for (const q of pool) if (q.domain in byDomain) byDomain[q.domain] += 1;
  return { total: pool.length, byDomain };
}

/**
 * The questions worth revisiting: those whose most recent graded answer was
 * wrong, plus anything bookmarked. A question drops out of the pool as soon as
 * the learner answers it correctly, which is the point of the mode.
 *
 * A logged-out visitor has no history, so this returns an empty pool rather
 * than touching the database — this is what lets the Dashboard render one
 * code path whether or not the visitor is signed in.
 */
export function loadReviewPool(db: Db, userId: string | null, cert: Certification): PoolQuestion[] {
  if (userId === null) return [];

  const latestGraded = db
    .select({
      questionId: sessionQuestions.questionId,
      latestAt: max(examSessions.submittedAt).as("latest_at"),
    })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .where(
      and(
        isNotNull(examSessions.submittedAt),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .groupBy(sessionQuestions.questionId)
    .as("latest_graded");

  const stillWrong = db
    .select({ questionId: sessionQuestions.questionId })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .innerJoin(
      latestGraded,
      and(
        eq(latestGraded.questionId, sessionQuestions.questionId),
        eq(latestGraded.latestAt, examSessions.submittedAt),
      ),
    )
    .where(
      and(
        eq(sessionQuestions.isCorrect, false),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .all()
    .map((r) => r.questionId);

  const bookmarked = db
    .select({ questionId: bookmarks.questionId })
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId))
    .all()
    .map((r) => r.questionId);

  const ids = new Set([...stillWrong, ...bookmarked]);
  if (ids.size === 0) return [];

  return loadPool(db, cert, undefined, userId).filter((q) => ids.has(q.id));
}

export function createSession(db: Db, userId: string | null, options: CreateSessionOptions): number {
  const owner = requireUserId(userId);
  const { certificationCode, mode, domain, now = Date.now() } = options;

  const cert = getCertification(db, certificationCode);
  if (!cert) throw new Error(`Certification ${certificationCode} does not exist`);

  if (mode === "domain" && !domain) {
    throw new Error("A domain is required for a domain-practice session");
  }
  if (domain && !cert.domains.some((d) => d.code === domain)) {
    throw new Error(`Domain ${domain} is not part of ${cert.code}`);
  }

  const total =
    options.total ?? (mode === "mock" ? cert.questionCount : PRACTICE_TOTALS[mode]);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const weights = cert.domains.map((d) => ({ code: d.code, weight: d.weight }));

  const plan =
    mode === "review"
      ? buildSessionPlan({
          domains: weights,
          pool: loadReviewPool(db, owner, cert),
          total,
          seed,
          blueprint: false,
        })
      : buildSessionPlan({
          domains: weights,
          pool: loadPool(db, cert, domain, owner),
          total,
          domain,
          seed,
        });

  if (plan.questionIds.length === 0) {
    throw new Error(
      `${cert.code} has no questions available for this mode yet`,
    );
  }

  const domainId = domain ? cert.domains.find((d) => d.code === domain)!.id : null;

  return db.transaction((tx) => {
    const session = tx
      .insert(examSessions)
      .values({
        userId: owner,
        certificationId: cert.id,
        mode,
        domainFilterId: domainId,
        questionCount: plan.questionIds.length,
        timeLimitSec: mode === "mock" ? cert.timeLimitSec : null,
        shuffleSeed: seed,
        startedAt: now,
      })
      .returning({ id: examSessions.id })
      .get();

    tx.insert(sessionQuestions)
      .values(
        plan.questionIds.map((questionId, i) => ({
          sessionId: session.id,
          questionId,
          position: i + 1,
        })),
      )
      .run();

    return session.id;
  });
}

export interface TakingOption {
  id: number;
  /** Display label, assigned by position after the per-session shuffle. */
  label: OptionLabel;
  text: string;
}

export interface TakingQuestion {
  position: number;
  questionId: number;
  domain: string;
  domainName: string;
  stem: string;
  caseStudy: { title: string; body: string } | null;
  options: TakingOption[];
  selectedOptionId: number | null;
  flagged: boolean;
}

export interface SessionHeader {
  id: number;
  certificationCode: string;
  certificationName: string;
  accent: Certification["accent"];
  mode: ExamMode;
  domain: string | null;
  questionCount: number;
  timeLimitSec: number | null;
  startedAt: number;
  submittedAt: number | null;
}

export interface TakingView {
  session: SessionHeader;
  questions: TakingQuestion[];
}

/**
 * "Doesn't exist" and "exists but belongs to someone else" throw the exact
 * same error — one shape, so a guessed session id can't be used to probe
 * whether it belongs to another user, and the API layer's existing 404
 * mapping needs no changes.
 */
function requireSession(db: Db, userId: string | null, sessionId: number) {
  const owner = requireUserId(userId);
  const session = db.select().from(examSessions).where(eq(examSessions.id, sessionId)).get();
  if (!session || session.userId !== owner) throw new Error(`Session ${sessionId} does not exist`);
  return session;
}

function headerOf(
  session: typeof examSessions.$inferSelect,
  cert: Certification,
): SessionHeader {
  return {
    id: session.id,
    certificationCode: cert.code,
    certificationName: cert.name,
    accent: cert.accent,
    mode: session.mode,
    domain: session.domainFilterId
      ? (cert.domains.find((d) => d.id === session.domainFilterId)?.code ?? null)
      : null,
    questionCount: session.questionCount,
    timeLimitSec: session.timeLimitSec,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
  };
}

/**
 * The view served while the learner is still working.
 *
 * This deliberately carries no `isCorrect`, no rationale and no explanation:
 * during a mock exam that data must not reach the browser at all, and keeping
 * it out of one shared shape is easier to keep honest than filtering per caller.
 */
export function getSessionForTaking(db: Db, userId: string | null, sessionId: number): TakingView {
  const session = requireSession(db, userId, sessionId);
  const cert = getCertificationById(db, session.certificationId)!;

  const rows = db
    .select({
      position: sessionQuestions.position,
      questionId: questions.id,
      domain: domains.code,
      domainName: domains.name,
      stem: questions.stem,
      selectedOptionId: sessionQuestions.selectedOptionId,
      flagged: sessionQuestions.flagged,
      caseTitle: caseStudies.title,
      caseBody: caseStudies.body,
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(caseStudies, eq(caseStudies.id, questions.caseStudyId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .orderBy(sessionQuestions.position)
    .all();

  const optionsByQuestion = loadOptions(db, rows.map((r) => r.questionId));

  return {
    session: headerOf(session, cert),
    questions: rows.map((r) => ({
      position: r.position,
      questionId: r.questionId,
      domain: r.domain,
      domainName: r.domainName,
      stem: r.stem,
      caseStudy: r.caseTitle ? { title: r.caseTitle, body: r.caseBody! } : null,
      options: shuffleForDisplay(
        optionsByQuestion.get(r.questionId) ?? [],
        session.shuffleSeed,
        r.questionId,
      ).map((o, i) => ({ id: o.id, label: OPTION_LABELS[i], text: o.text })),
      selectedOptionId: r.selectedOptionId,
      flagged: r.flagged,
    })),
  };
}

interface StoredOption {
  id: number;
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  rationale: string;
}

function loadOptions(db: Db, questionIds: number[]): Map<number, StoredOption[]> {
  const byQuestion = new Map<number, StoredOption[]>();
  if (questionIds.length === 0) return byQuestion;

  const rows = db
    .select()
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, questionIds))
    .orderBy(questionOptions.label)
    .all();

  for (const row of rows) {
    const bucket = byQuestion.get(row.questionId);
    const option = {
      id: row.id,
      label: row.label,
      text: row.text,
      isCorrect: row.isCorrect,
      rationale: row.rationale,
    };
    if (bucket) bucket.push(option);
    else byQuestion.set(row.questionId, [option]);
  }
  return byQuestion;
}

/** Per-question shuffle so the correct answer is not always in the same slot. */
function shuffleForDisplay<T>(options: T[], seed: number, questionId: number): T[] {
  return seededShuffle(options, (seed + questionId * 2654435761) >>> 0);
}

export interface AnswerPatch {
  selectedOptionId?: number | null;
  flagged?: boolean;
  timeSpentSec?: number;
}

export function saveAnswer(
  db: Db,
  userId: string | null,
  sessionId: number,
  questionId: number,
  patch: AnswerPatch,
  now: number = Date.now(),
): void {
  const session = requireSession(db, userId, sessionId);
  if (session.submittedAt !== null) {
    throw new Error(`Session ${sessionId} has already been submitted`);
  }

  const row = db
    .select({ id: sessionQuestions.id })
    .from(sessionQuestions)
    .where(
      and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, questionId)),
    )
    .get();
  if (!row) throw new Error(`Question ${questionId} is not part of session ${sessionId}`);

  if (patch.selectedOptionId != null) {
    const owns = db
      .select({ id: questionOptions.id })
      .from(questionOptions)
      .where(
        and(
          eq(questionOptions.id, patch.selectedOptionId),
          eq(questionOptions.questionId, questionId),
        ),
      )
      .get();
    if (!owns) {
      throw new Error(`Option ${patch.selectedOptionId} does not belong to question ${questionId}`);
    }
  }

  db.update(sessionQuestions)
    .set({
      ...(patch.selectedOptionId !== undefined
        ? { selectedOptionId: patch.selectedOptionId, answeredAt: now }
        : {}),
      ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      ...(patch.timeSpentSec !== undefined ? { timeSpentSec: patch.timeSpentSec } : {}),
    })
    .where(eq(sessionQuestions.id, row.id))
    .run();
}

/** Grade the session, freeze it, and return the score. */
export function submitSession(
  db: Db,
  userId: string | null,
  sessionId: number,
  now: number = Date.now(),
): ScoreResult {
  const session = requireSession(db, userId, sessionId);
  if (session.submittedAt !== null) {
    throw new Error(`Session ${sessionId} was already submitted`);
  }
  const cert = getCertificationById(db, session.certificationId)!;

  const rows = db
    .select({
      sessionQuestionId: sessionQuestions.id,
      questionId: sessionQuestions.questionId,
      selectedOptionId: sessionQuestions.selectedOptionId,
      domain: domains.code,
      correctOptionId: sql<number>`(
        select id from question_options
        where question_id = ${sessionQuestions.questionId} and is_correct = 1
      )`.as("correct_option_id"),
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .all();

  const score = scoreSession(
    rows,
    cert.domains.map((d) => d.code),
    cert.passThresholdPercent,
  );

  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(sessionQuestions)
        .set({
          isCorrect:
            row.selectedOptionId !== null && row.selectedOptionId === row.correctOptionId,
        })
        .where(eq(sessionQuestions.id, row.sessionQuestionId))
        .run();
    }
    tx.update(examSessions)
      .set({ submittedAt: now, score: score.correct })
      .where(eq(examSessions.id, sessionId))
      .run();
  });

  return score;
}

export interface ResultOption extends TakingOption {
  isCorrect: boolean;
  rationale: string;
}

export interface ResultQuestion {
  position: number;
  questionId: number;
  domain: string;
  domainName: string;
  sourceRef: string;
  sourceTask: string;
  stem: string;
  caseStudy: { title: string; body: string } | null;
  explanation: string;
  options: ResultOption[];
  selectedOptionId: number | null;
  isCorrect: boolean;
  flagged: boolean;
  note: string | null;
  bookmarked: boolean;
}

export interface ResultView {
  session: SessionHeader;
  certification: Certification;
  score: ScoreResult;
  questions: ResultQuestion[];
}

/** The full post-mortem, available only once the session is graded. */
export function getSessionResult(db: Db, userId: string | null, sessionId: number): ResultView {
  const session = requireSession(db, userId, sessionId);
  if (session.submittedAt === null) {
    throw new Error(`Session ${sessionId} has not been submitted yet`);
  }
  const cert = getCertificationById(db, session.certificationId)!;
  const owner = session.userId;

  const rows = db
    .select({
      position: sessionQuestions.position,
      questionId: questions.id,
      domain: domains.code,
      domainName: domains.name,
      sourceRef: questions.sourceRef,
      sourceTask: questions.sourceTask,
      stem: questions.stem,
      explanation: questions.explanation,
      selectedOptionId: sessionQuestions.selectedOptionId,
      isCorrect: sessionQuestions.isCorrect,
      flagged: sessionQuestions.flagged,
      caseTitle: caseStudies.title,
      caseBody: caseStudies.body,
      note: sql<string | null>`(select body from user_notes where question_id = ${questions.id} and user_id = ${owner})`.as(
        "note",
      ),
      bookmarked: sql<number>`(select count(*) from bookmarks where question_id = ${questions.id} and user_id = ${owner})`.as(
        "bookmarked",
      ),
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(caseStudies, eq(caseStudies.id, questions.caseStudyId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .orderBy(sessionQuestions.position)
    .all();

  const optionsByQuestion = loadOptions(db, rows.map((r) => r.questionId));

  const score = scoreSession(
    rows.map((r) => ({
      domain: r.domain,
      selectedOptionId: r.selectedOptionId,
      correctOptionId:
        (optionsByQuestion.get(r.questionId) ?? []).find((o) => o.isCorrect)?.id ?? -1,
    })),
    cert.domains.map((d) => d.code),
    cert.passThresholdPercent,
  );

  return {
    session: headerOf(session, cert),
    certification: cert,
    score,
    questions: rows.map((r) => ({
      position: r.position,
      questionId: r.questionId,
      domain: r.domain,
      domainName: r.domainName,
      sourceRef: r.sourceRef,
      sourceTask: r.sourceTask,
      stem: r.stem,
      caseStudy: r.caseTitle ? { title: r.caseTitle, body: r.caseBody! } : null,
      explanation: r.explanation,
      options: shuffleForDisplay(
        optionsByQuestion.get(r.questionId) ?? [],
        session.shuffleSeed,
        r.questionId,
      ).map((o, i) => ({
        id: o.id,
        label: OPTION_LABELS[i],
        text: o.text,
        isCorrect: o.isCorrect,
        rationale: o.rationale,
      })),
      selectedOptionId: r.selectedOptionId,
      isCorrect: r.isCorrect ?? false,
      flagged: r.flagged,
      note: r.note,
      bookmarked: r.bookmarked > 0,
    })),
  };
}
```

- [ ] **Step 2: Update imports in `sessions.test.ts`**

Find the import of test-support fixtures near the top of `src/lib/exam/sessions.test.ts` (it currently imports `seedCatalogAndBank`, possibly alongside other names — check the actual line) and add `createTestUser` to it. For example, if the line reads:

```ts
import { seedCatalogAndBank } from "@/test-support/bank";
```

Replace with:

```ts
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
```

Also add, near the top of the file:

```ts
import { toggleBookmark } from "@/lib/notes";
```

- [ ] **Step 3: Add `userId` state and mechanically thread it through every call**

Wherever the file declares `let db: Db;`, add a sibling declaration:

```ts
let db: Db;
let userId: string;
```

Wherever the file's `beforeEach` sets `db = createDatabase(":memory:");`, add a line right after it:

```ts
userId = createTestUser(db);
```

Then run:

```bash
sed -i '' \
  -e 's/createSession(db, /createSession(db, userId, /g' \
  -e 's/getSessionForTaking(db, /getSessionForTaking(db, userId, /g' \
  -e 's/saveAnswer(db, /saveAnswer(db, userId, /g' \
  -e 's/submitSession(db, /submitSession(db, userId, /g' \
  -e 's/getSessionResult(db, /getSessionResult(db, userId, /g' \
  -e 's/loadReviewPool(db, /loadReviewPool(db, userId, /g' \
  src/lib/exam/sessions.test.ts
```

`getBankCoverage(db, ...)` calls are deliberately **not** in this list — that function's signature did not change.

- [ ] **Step 4: Fix any helper functions whose own parameter is also named `db`/local session id**

The sed above also touches calls made *inside* this test file's own local helper functions (`answerAll`, which calls `getSessionForTaking(db, sessionId)` and `saveAnswer(db, sessionId, q.questionId, { selectedOptionId: chosen })`). Since those helpers close over the file-level `userId` variable exactly like they already close over `db`, no further change is needed there — just re-read the file after the `sed` step and confirm every call reads `(db, userId, ...)` with no double-insertion.

One call site the `sed` step does **not** catch, because it isn't a call to any of the six threaded functions: the raw fixture insert in the `"keeps bookmarked questions even when answered correctly"` test. Find:

```ts
    db.insert(bookmarks).values({ questionId: view.questions[0].questionId }).run();
```

Replace with:

```ts
    db.insert(bookmarks).values({ questionId: view.questions[0].questionId, userId }).run();
```

(`bookmarks.userId` is now `NOT NULL` per Task 1 — this insert would otherwise fail with a constraint error.)

- [ ] **Step 5: Add per-user isolation coverage**

Append a new `describe` block at the end of `src/lib/exam/sessions.test.ts` (reusing the file's own `cert(code)` helper, already defined near the top as `const cert = (code: string) => getCertification(db, code)!;`):

```ts
describe("per-user isolation", () => {
  test("a session belongs only to the user who created it", () => {
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    const other = createTestUser(db, "other-user");
    expect(() => getSessionForTaking(db, other, id)).toThrow(/does not exist/);
  });

  test("bookmarks are private, so the review pool never crosses users", () => {
    seedCatalogAndBank(db, 6);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 5 });
    const q = getSessionForTaking(db, userId, id).questions[0];
    toggleBookmark(db, userId, q.questionId);

    const other = createTestUser(db, "other-user");
    expect(loadReviewPool(db, other, cert("CBAP"))).toEqual([]);
    expect(loadReviewPool(db, userId, cert("CBAP")).map((p) => p.id)).toContain(q.questionId);
  });

  test("rejects a null userId when creating a session", () => {
    expect(() =>
      createSession(db, null, { certificationCode: "CBAP", mode: "quick", total: 5 }),
    ).toThrow(/userId/);
  });
});
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/lib/exam/sessions.test.ts
```

Expected: all tests pass, including the three new ones. If any pre-existing test fails, it's almost certainly a spot the `sed` step double-matched or missed — inspect that line directly rather than re-running `sed`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/exam/sessions.ts src/lib/exam/sessions.test.ts
git commit -m "feat(exam): scope sessions to the signed-in user with an ownership check"
```

---

### Task 7: `analytics.ts` — thread `userId`

**Files:**
- Modify: `src/lib/analytics.ts`
- Modify: `src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: `createTestUser` from `@/test-support/bank` (Task 3); `createSession`, `getSessionForTaking`, `saveAnswer`, `submitSession` from `@/lib/exam/sessions` (Task 6, already `userId`-scoped).
- Produces: `getReadiness(db, userId, cert)`, `getSessionHistory(db, userId, cert, limit?)` — both return the zeroed/empty shape when `userId` is `null`.

- [ ] **Step 1: Rewrite `src/lib/analytics.ts`**

```ts
import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { Certification } from "./catalog";
import type { Db } from "./db";
import { domains, examSessions, questions, sessionQuestions } from "./db/schema";
import type { ExamMode } from "./domain";

export interface DomainAccuracy {
  total: number;
  correct: number;
  percent: number;
}

export interface Readiness {
  answered: number;
  correct: number;
  overallPercent: number;
  /** True once lifetime accuracy clears this certification's threshold. */
  onTrack: boolean;
  byDomain: Record<string, DomainAccuracy>;
  /** Domains below the threshold, weakest first. Empty when all are healthy. */
  weakestDomains: string[];
}

function percentOf(correct: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((correct / total) * 1000) / 10;
}

function emptyReadiness(cert: Certification): Readiness {
  const byDomain = Object.fromEntries(
    cert.domains.map((d) => [d.code, { total: 0, correct: 0, percent: 0 }]),
  ) as Record<string, DomainAccuracy>;
  return { answered: 0, correct: 0, overallPercent: 0, onTrack: false, byDomain, weakestDomains: [] };
}

/**
 * Lifetime accuracy for one certification, sliced by its own domains.
 *
 * Scoped per certification because progress does not transfer: a strong CBAP
 * record says nothing about ECBA, which examines a different framework
 * entirely.
 *
 * Only submitted sessions count: an exam still in progress has no answers worth
 * measuring, and half-finished attempts would drag the numbers down unfairly.
 *
 * A logged-out visitor has no history — this returns the same zeroed shape a
 * brand-new signed-in user would see, without touching the database.
 */
export function getReadiness(db: Db, userId: string | null, cert: Certification): Readiness {
  if (userId === null) return emptyReadiness(cert);

  const rows = db
    .select({ domain: domains.code, isCorrect: sessionQuestions.isCorrect })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(
      and(
        isNotNull(examSessions.submittedAt),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .all();

  const byDomain = Object.fromEntries(
    cert.domains.map((d) => [d.code, { total: 0, correct: 0, percent: 0 }]),
  ) as Record<string, DomainAccuracy>;

  let correct = 0;
  for (const row of rows) {
    const bucket = byDomain[row.domain];
    if (!bucket) continue;
    bucket.total += 1;
    if (row.isCorrect) {
      bucket.correct += 1;
      correct += 1;
    }
  }

  for (const d of cert.domains) {
    byDomain[d.code].percent = percentOf(byDomain[d.code].correct, byDomain[d.code].total);
  }

  const weakestDomains = cert.domains
    .map((d) => d.code)
    .filter((code) => byDomain[code].total > 0 && byDomain[code].percent < cert.passThresholdPercent)
    .sort((a, b) => byDomain[a].percent - byDomain[b].percent);

  const answered = rows.length;

  return {
    answered,
    correct,
    overallPercent: percentOf(correct, answered),
    onTrack: answered > 0 && (correct / answered) * 100 >= cert.passThresholdPercent,
    byDomain,
    weakestDomains,
  };
}

export interface HistoryEntry {
  id: number;
  mode: ExamMode;
  domain: string | null;
  questionCount: number;
  score: number;
  percent: number;
  passed: boolean;
  startedAt: number;
  submittedAt: number;
  /** Wall-clock seconds spent, useful for pacing against the real time limit. */
  durationSec: number;
}

export function getSessionHistory(
  db: Db,
  userId: string | null,
  cert: Certification,
  limit = 50,
): HistoryEntry[] {
  if (userId === null) return [];

  const rows = db
    .select({
      session: examSessions,
      domainCode: domains.code,
    })
    .from(examSessions)
    .leftJoin(domains, eq(domains.id, examSessions.domainFilterId))
    .where(
      and(
        isNotNull(examSessions.submittedAt),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .orderBy(desc(examSessions.submittedAt), desc(examSessions.id))
    .limit(limit)
    .all();

  return rows.map(({ session: s, domainCode }) => ({
    id: s.id,
    mode: s.mode,
    domain: domainCode,
    questionCount: s.questionCount,
    score: s.score ?? 0,
    percent: percentOf(s.score ?? 0, s.questionCount),
    passed:
      s.questionCount > 0 &&
      ((s.score ?? 0) / s.questionCount) * 100 >= cert.passThresholdPercent,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt!,
    durationSec: Math.max(0, Math.round((s.submittedAt! - s.startedAt) / 1000)),
  }));
}
```

- [ ] **Step 2: Update imports and threading in `analytics.test.ts`**

Find:
```ts
import { seedCatalogAndBank } from "@/test-support/bank";
```

Replace with:
```ts
import { createTestUser, seedCatalogAndBank } from "@/test-support/bank";
```

Find:
```ts
let db: Db;
```

Replace with:
```ts
let db: Db;
let userId: string;
```

Find:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
});
```

Replace with:
```ts
beforeEach(() => {
  db = createDatabase(":memory:");
  userId = createTestUser(db);
});
```

```bash
sed -i '' \
  -e 's/getReadiness(db, /getReadiness(db, userId, /g' \
  -e 's/getSessionHistory(db, /getSessionHistory(db, userId, /g' \
  -e 's/createSession(db, /createSession(db, userId, /g' \
  -e 's/getSessionForTaking(db, /getSessionForTaking(db, userId, /g' \
  -e 's/saveAnswer(db, /saveAnswer(db, userId, /g' \
  -e 's/submitSession(db, /submitSession(db, userId, /g' \
  src/lib/analytics.test.ts
```

- [ ] **Step 3: Add per-user isolation coverage**

Append at the end of `src/lib/analytics.test.ts`:

```ts
describe("per-user isolation", () => {
  test("readiness and history never include another user's sessions", () => {
    seedBank(6);
    const id = createSession(db, userId, { certificationCode: "CBAP", mode: "quick", total: 6 });
    play(id, 6);

    const other = createTestUser(db, "other-user");
    expect(getReadiness(db, other, cbap()).answered).toBe(0);
    expect(getSessionHistory(db, other, cbap())).toEqual([]);
    expect(getReadiness(db, userId, cbap()).answered).toBe(6);
  });

  test("a null userId returns the empty/zero shape without touching another user's data", () => {
    expect(getReadiness(db, null, cbap()).answered).toBe(0);
    expect(getSessionHistory(db, null, cbap())).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lib/analytics.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat(analytics): scope readiness and history to the signed-in user"
```

---

### Task 8: `_http.ts` — `unauthorized()` helper

**Files:**
- Modify: `src/app/api/_http.ts`

**Interfaces:**
- Produces: `export function unauthorized(): Response` — a 401 JSON response, used by every route in Task 9.

- [ ] **Step 1: Add the helper**

Find:
```ts
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
```

Replace with:
```ts
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function unauthorized(): Response {
  return json({ error: "Sign-in required" }, 401);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/_http.ts
git commit -m "feat(api): add unauthorized() 401 helper"
```

---

### Task 9: API routes — wire `auth()` + 401

**Files:**
- Modify: `src/app/api/sessions/route.ts`
- Modify: `src/app/api/sessions/[id]/route.ts`
- Modify: `src/app/api/sessions/[id]/answers/route.ts`
- Modify: `src/app/api/sessions/[id]/submit/route.ts`
- Modify: `src/app/api/sessions/[id]/result/route.ts`
- Modify: `src/app/api/questions/[id]/bookmark/route.ts`
- Modify: `src/app/api/questions/[id]/note/route.ts`
- Modify: `src/app/api/flashcards/due/route.ts`
- Modify: `src/app/api/flashcards/[id]/review/route.ts`
- Modify: `src/app/api/stats/route.ts`
- Modify: `src/app/api/api.test.ts`
- Not touched: `src/app/api/certifications/route.ts` (catalog data, not personal — stays public)

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth` (Task 2), `unauthorized()` from `@/app/api/_http` (Task 8), the `userId`-scoped `lib/*` functions from Tasks 4–7.

- [ ] **Step 1: `src/app/api/sessions/route.ts`**

```ts
import { z } from "zod";

import { errorResponse, json, readJson, unauthorized } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXAM_MODES } from "@/lib/domain";
import { createSession } from "@/lib/exam/sessions";

const bodySchema = z.object({
  certificationCode: z.string().min(1).max(16),
  mode: z.enum(EXAM_MODES),
  /** Domain code within the certification's framework; required for mode "domain". */
  domain: z.string().min(1).max(12).optional(),
  total: z.number().int().min(1).max(400).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const body = bodySchema.parse(await readJson(request));
    return json({ sessionId: createSession(db, session.user.id, body) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 2: `src/app/api/sessions/[id]/route.ts`**

```ts
import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionForTaking } from "@/lib/exam/sessions";

/** The in-progress view. Carries no answer key — see getSessionForTaking. */
export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json(getSessionForTaking(db, session.user.id, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 3: `src/app/api/sessions/[id]/answers/route.ts`**

```ts
import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveAnswer } from "@/lib/exam/sessions";

const bodySchema = z.object({
  questionId: z.number().int().positive(),
  selectedOptionId: z.number().int().positive().nullable().optional(),
  flagged: z.boolean().optional(),
  timeSpentSec: z.number().int().min(0).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const sessionId = await numericParam(ctx.params);
    const { questionId, ...patch } = bodySchema.parse(await readJson(request));
    saveAnswer(db, session.user.id, sessionId, questionId, patch);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 4: `src/app/api/sessions/[id]/submit/route.ts`**

```ts
import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { submitSession } from "@/lib/exam/sessions";

export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json(submitSession(db, session.user.id, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 5: `src/app/api/sessions/[id]/result/route.ts`**

```ts
import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionResult } from "@/lib/exam/sessions";

/** The post-mortem: explanations, per-option reasoning, BABOK references. */
export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json(getSessionResult(db, session.user.id, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 6: `src/app/api/questions/[id]/bookmark/route.ts`**

```ts
import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toggleBookmark } from "@/lib/notes";

export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json({ bookmarked: toggleBookmark(db, session.user.id, await numericParam(ctx.params)) });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 7: `src/app/api/questions/[id]/note/route.ts`**

```ts
import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getNote, saveNote } from "@/lib/notes";

const bodySchema = z.object({ body: z.string() });

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const questionId = await numericParam(ctx.params);
    const { body } = bodySchema.parse(await readJson(request));
    saveNote(db, session.user.id, questionId, body);
    return json({ note: getNote(db, session.user.id, questionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 8: `src/app/api/flashcards/due/route.ts`**

```ts
import { z } from "zod";

import { errorResponse, json, unauthorized } from "@/app/api/_http";
import { getCertification } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECKS } from "@/lib/domain";
import { getDueCards } from "@/lib/srs/decks";

const querySchema = z.object({
  /** Optional: scope to the decks of this certification's framework. */
  certification: z.string().min(1).max(16).optional(),
  deck: z.enum(DECKS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();

    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      certification: params.get("certification") ?? undefined,
      deck: params.get("deck") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    let frameworkId: number | undefined;
    if (query.certification) {
      const cert = getCertification(db, query.certification);
      if (!cert) throw new Error(`Certification ${query.certification} does not exist`);
      frameworkId = cert.framework.id;
    }

    return json(getDueCards(db, session.user.id, { frameworkId, deck: query.deck, limit: query.limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 9: `src/app/api/flashcards/[id]/review/route.ts`**

```ts
import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { REVIEW_GRADES } from "@/lib/domain";
import { reviewCard } from "@/lib/srs/decks";

const bodySchema = z.object({
  button: z.enum(Object.keys(REVIEW_GRADES) as [string, ...string[]]),
});

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const cardId = await numericParam(ctx.params);
    const { button } = bodySchema.parse(await readJson(request));
    return json(reviewCard(db, session.user.id, cardId, button as keyof typeof REVIEW_GRADES));
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 10: `src/app/api/stats/route.ts`**

```ts
import { errorResponse, json, unauthorized } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { getCertification } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";

/** Everything the dashboard needs for one certification, in one round trip. */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();

    const code = new URL(request.url).searchParams.get("certification");
    if (!code) throw new Error("A certification query parameter is required");

    const cert = getCertification(db, code);
    if (!cert) throw new Error(`Certification ${code} does not exist`);

    return json({
      certification: {
        code: cert.code,
        name: cert.name,
        nameVi: cert.nameVi,
        accent: cert.accent,
        framework: cert.framework,
        questionCount: cert.questionCount,
        timeLimitSec: cert.timeLimitSec,
        passThresholdPercent: cert.passThresholdPercent,
        passThresholdSource: cert.passThresholdSource,
        proficiencyLabel: cert.proficiencyLabel,
        domains: cert.domains,
      },
      readiness: getReadiness(db, session.user.id, cert),
      history: getSessionHistory(db, session.user.id, cert, 20),
      decks: getDeckStats(db, session.user.id, cert.framework.id),
      coverage: getBankCoverage(db, cert),
      reviewPoolSize: loadReviewPool(db, session.user.id, cert).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
```

- [ ] **Step 11: Update `api.test.ts`'s `boot()` to mock `auth()` and create the test user**

Find:
```ts
import { seedCatalogAndBank } from "@/test-support/bank";
```

Replace with:
```ts
import { createTestUser, seedCatalogAndBank, TEST_USER_ID } from "@/test-support/bank";
```

Find:
```ts
/** Fresh module graph — and therefore a fresh in-memory database — per test. */
async function boot(questionsPerKa = 4) {
  vi.resetModules();
  // The db module caches its handle on globalThis to survive Next.js hot
  // reloads, which also makes it survive resetModules. Drop it so each test
  // really does start from an empty database.
  delete (globalThis as { cbapDb?: unknown }).cbapDb;

  const { db } = await import("@/lib/db");
  const { importFlashcardDeck } = await import("@/lib/content/importer");

  seedCatalogAndBank(db, questionsPerKa);
  importFlashcardDeck(db, {
    version: 1,
    frameworkCode: "babok-v3",
    deck: "techniques",
    cards: [{ code: "T-1", front: "Document Analysis", back: "Study existing documentation." }],
  });

  return {
    db,
    certifications: await import("@/app/api/certifications/route"),
    sessions: await import("@/app/api/sessions/route"),
    session: await import("@/app/api/sessions/[id]/route"),
    answers: await import("@/app/api/sessions/[id]/answers/route"),
    submit: await import("@/app/api/sessions/[id]/submit/route"),
    result: await import("@/app/api/sessions/[id]/result/route"),
    note: await import("@/app/api/questions/[id]/note/route"),
    bookmark: await import("@/app/api/questions/[id]/bookmark/route"),
    due: await import("@/app/api/flashcards/due/route"),
    review: await import("@/app/api/flashcards/[id]/review/route"),
    stats: await import("@/app/api/stats/route"),
  };
}
```

Replace with:
```ts
/**
 * Fresh module graph — and therefore a fresh in-memory database — per test.
 *
 * `@/lib/auth` is mocked so route handlers see a real session without a real
 * Google OAuth round trip. `authState` is mutable so a single `boot()` call
 * can simulate more than one caller against the same database — see the
 * "auth boundary" tests below, which need a second user in the *same* db.
 */
async function boot(questionsPerKa = 4) {
  vi.resetModules();
  // The db module caches its handle on globalThis to survive Next.js hot
  // reloads, which also makes it survive resetModules. Drop it so each test
  // really does start from an empty database.
  delete (globalThis as { cbapDb?: unknown }).cbapDb;

  const authState: { userId: string | null } = { userId: TEST_USER_ID };
  vi.doMock("@/lib/auth", () => ({
    auth: async () =>
      authState.userId ? { user: { id: authState.userId, email: `${authState.userId}@example.test` } } : null,
  }));

  const { db } = await import("@/lib/db");
  const { importFlashcardDeck } = await import("@/lib/content/importer");

  seedCatalogAndBank(db, questionsPerKa);
  createTestUser(db, TEST_USER_ID);
  importFlashcardDeck(db, {
    version: 1,
    frameworkCode: "babok-v3",
    deck: "techniques",
    cards: [{ code: "T-1", front: "Document Analysis", back: "Study existing documentation." }],
  });

  return {
    db,
    setUser: (userId: string | null) => {
      authState.userId = userId;
    },
    certifications: await import("@/app/api/certifications/route"),
    sessions: await import("@/app/api/sessions/route"),
    session: await import("@/app/api/sessions/[id]/route"),
    answers: await import("@/app/api/sessions/[id]/answers/route"),
    submit: await import("@/app/api/sessions/[id]/submit/route"),
    result: await import("@/app/api/sessions/[id]/result/route"),
    note: await import("@/app/api/questions/[id]/note/route"),
    bookmark: await import("@/app/api/questions/[id]/bookmark/route"),
    due: await import("@/app/api/flashcards/due/route"),
    review: await import("@/app/api/flashcards/[id]/review/route"),
    stats: await import("@/app/api/stats/route"),
  };
}
```

All pre-existing tests in this file are unaffected: `boot()` still defaults to a signed-in `TEST_USER_ID`, so every existing `app.sessions.POST(...)`, `app.session.GET(...)`, etc. call keeps working exactly as before.

- [ ] **Step 12: Add the "auth boundary" describe block**

Append at the end of `src/app/api/api.test.ts`:

```ts
describe("auth boundary", () => {
  test("POST /api/sessions returns 401 with no session", async () => {
    const app = await boot();
    app.setUser(null);
    const res = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }));
    expect(res.status).toBe(401);
  });

  test("GET /api/sessions/:id returns 401 with no session", async () => {
    const app = await boot();
    app.setUser(null);
    const res = await app.session.GET(new Request("http://localhost/api"), ctx(1));
    expect(res.status).toBe(401);
  });

  test("POST /api/flashcards/due review returns 401 with no session", async () => {
    const app = await boot();
    const due = await app.due.GET(new Request("http://localhost/api/flashcards/due"));
    expect(due.status).toBe(200);

    app.setUser(null);
    const res = await app.review.POST(post({ button: "good" }), ctx(1));
    expect(res.status).toBe(401);
  });

  test("another user's session is not found, never exposed", async () => {
    const app = await boot();
    const created = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }));
    const { sessionId } = await created.json();

    createTestUser(app.db, "someone-else");
    app.setUser("someone-else");
    const res = await app.session.GET(new Request("http://localhost/api"), ctx(sessionId));
    expect(res.status).toBe(404);
  });

  test("another user cannot answer or submit someone else's session", async () => {
    const app = await boot();
    const created = await app.sessions.POST(post({ certificationCode: "CBAP", mode: "quick", total: 5 }));
    const { sessionId } = await created.json();
    const view = await (await app.session.GET(new Request("http://localhost/api"), ctx(sessionId))).json();
    const questionId = view.questions[0].questionId;

    createTestUser(app.db, "someone-else");
    app.setUser("someone-else");

    const answerRes = await app.answers.PATCH(
      post({ questionId, selectedOptionId: view.questions[0].options[0].id }),
      ctx(sessionId),
    );
    expect(answerRes.status).toBe(404);

    const submitRes = await app.submit.POST(post(), ctx(sessionId));
    expect(submitRes.status).toBe(404);
  });
});
```

- [ ] **Step 13: Run the tests**

```bash
npx vitest run src/app/api/api.test.ts
```

Expected: all pre-existing tests still pass, plus the five new "auth boundary" tests.

- [ ] **Step 14: Commit**

```bash
git add src/app/api/ 
git commit -m "feat(api): require sign-in for every personal-data route"
```

---

### Task 10: Server Actions — auth + redirect

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth` (Task 2), the `userId`-scoped `lib/*` functions from Tasks 4–7.
- Produces: a `requireUserId(returnTo)` helper that every action calls first; redirects to `/api/auth/signin?callbackUrl=...` when there's no session.

- [ ] **Step 1: Rewrite `src/app/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXAM_MODES, REVIEW_GRADES, type ExamMode, type ReviewButton } from "@/lib/domain";
import { createSession, submitSession } from "@/lib/exam/sessions";
import { saveNote, toggleBookmark } from "@/lib/notes";
import { reviewCard } from "@/lib/srs/decks";

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

function int(form: FormData, key: string): number {
  return Number(str(form, key));
}

/**
 * Every Server Action that writes personal progress calls this first. A
 * logged-out learner is sent to Google sign-in and lands back on `returnTo`
 * — not a replay of the original form submission, since resuming the exact
 * in-flight action across an OAuth round trip isn't worth the complexity for
 * one extra click.
 */
async function requireUserId(returnTo: string): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  return userId;
}

/** Starts a session and takes the learner straight into it. */
export async function startSessionAction(form: FormData): Promise<void> {
  const mode = str(form, "mode") as ExamMode;
  if (!EXAM_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);

  const certificationCode = str(form, "certificationCode");
  const returnTo = str(form, "returnTo") || `/dashboard?cert=${certificationCode}`;
  const userId = await requireUserId(returnTo);

  const domain = str(form, "domain");
  const totalRaw = int(form, "total");

  const id = createSession(db, userId, {
    certificationCode,
    mode,
    domain: domain || undefined,
    total: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined,
  });

  redirect(`/exam/${id}`);
}

export async function submitSessionAction(form: FormData): Promise<void> {
  const sessionId = int(form, "sessionId");
  const userId = await requireUserId(`/exam/${sessionId}`);
  submitSession(db, userId, sessionId);
  redirect(`/result/${sessionId}`);
}

export async function saveNoteAction(form: FormData): Promise<void> {
  const returnTo = str(form, "returnTo") || "/dashboard";
  const userId = await requireUserId(returnTo);
  saveNote(db, userId, int(form, "questionId"), str(form, "body"));
  revalidatePath(returnTo);
}

export async function toggleBookmarkAction(form: FormData): Promise<void> {
  const returnTo = str(form, "returnTo") || "/dashboard";
  const userId = await requireUserId(returnTo);
  toggleBookmark(db, userId, int(form, "questionId"));
  revalidatePath(returnTo);
}

export async function reviewFlashcardAction(form: FormData): Promise<void> {
  const button = str(form, "button") as ReviewButton;
  if (!(button in REVIEW_GRADES)) throw new Error(`Unknown review button: ${button}`);
  const userId = await requireUserId("/flashcards");
  reviewCard(db, userId, int(form, "cardId"), button);
  revalidatePath("/flashcards");
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors from `src/app/actions.ts` itself (errors from page/component files that haven't been updated yet are expected until later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat(actions): require sign-in before writing personal progress"
```

---

### Task 11: `ModeCards.tsx` — carry `returnTo` for the sign-in redirect

**Files:**
- Modify: `src/components/ModeCards.tsx`

**Interfaces:**
- Consumes: `startSessionAction`'s `returnTo` form field (Task 10).

- [ ] **Step 1: Add a `returnTo` hidden field to every `<ModeCard>`**

There are four `<ModeCard>` blocks inside `ModeCards` (Mock exam, domain practice, Quick quiz, Ôn câu sai), each starting with:

```tsx
          <input type="hidden" name="certificationCode" value={certification.code} />
```

Add, immediately after each of those four lines:

```tsx
          <input type="hidden" name="returnTo" value={`/dashboard?cert=${certification.code}`} />
```

(The fifth card, Flashcard, is a `<LinkModeCard>` — a plain navigation link, not a form — so it needs no `returnTo` field; its gating is handled at the page level in Task 13.)

- [ ] **Step 2: Manual check**

```bash
grep -c 'name="returnTo"' src/components/ModeCards.tsx
```

Expected: `4`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ModeCards.tsx
git commit -m "feat(ui): carry returnTo through mode-card sign-in redirects"
```

---

### Task 12: Sign-in/out UI — components + `AppShell`

**Files:**
- Create: `src/components/auth/SignInButton.tsx`
- Create: `src/components/auth/SignOutButton.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Produces: `<SignInButton callbackUrl?: string />`, `<SignOutButton />`. `AppShell` gains a required `user: { name?: string | null; image?: string | null } | null` prop.

- [ ] **Step 1: `src/components/auth/SignInButton.tsx`**

```tsx
"use client";

import { signIn } from "next-auth/react";

export function SignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => void signIn("google", { callbackUrl })}
      className="rounded-lg bg-accent-solid px-3.5 py-1.5 text-body-small text-ink-inverse"
    >
      Đăng nhập với Google
    </button>
  );
}
```

- [ ] **Step 2: `src/components/auth/SignOutButton.tsx`**

```tsx
"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/dashboard" })}
      className="text-body-small text-ink-secondary hover:text-ink-primary"
    >
      Đăng xuất
    </button>
  );
}
```

- [ ] **Step 3: Add the `user` prop and header slot to `AppShell.tsx`**

Find:
```tsx
import Link from "next/link";

import { ACCENT_SOFT_BG, ACCENT_SOLID_BG, ACCENT_TEXT } from "@/lib/ui/accent";
import type { CertificationSummary } from "@/lib/ui/types";

interface AppShellProps {
  certifications: CertificationSummary[];
  current: CertificationSummary;
  active: "dashboard" | "flashcards" | "library";
  children: React.ReactNode;
}
```

Replace with:
```tsx
import Link from "next/link";

import { SignInButton } from "@/components/auth/SignInButton";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ACCENT_SOFT_BG, ACCENT_SOLID_BG, ACCENT_TEXT } from "@/lib/ui/accent";
import type { CertificationSummary } from "@/lib/ui/types";

interface AppShellProps {
  certifications: CertificationSummary[];
  current: CertificationSummary;
  active: "dashboard" | "flashcards" | "library";
  user: { name?: string | null; image?: string | null } | null;
  children: React.ReactNode;
}
```

Find:
```tsx
export function AppShell({ certifications, current, active, children }: AppShellProps) {
```

Replace with:
```tsx
export function AppShell({ certifications, current, active, user, children }: AppShellProps) {
```

Find:
```tsx
        <div className="flex w-full flex-wrap items-center gap-4 sm:ml-auto sm:w-auto sm:gap-6">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.key === "dashboard" ? `${item.href}?cert=${current.code}` : item.href}
              className={
                "text-body-small transition-colors " +
                (active === item.key ? "font-medium text-ink-primary" : "text-ink-secondary hover:text-ink-primary")
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </header>
```

Replace with:
```tsx
        <div className="flex w-full flex-wrap items-center gap-4 sm:ml-auto sm:w-auto sm:gap-6">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.key === "dashboard" ? `${item.href}?cert=${current.code}` : item.href}
              className={
                "text-body-small transition-colors " +
                (active === item.key ? "font-medium text-ink-primary" : "text-ink-secondary hover:text-ink-primary")
              }
            >
              {item.label}
            </Link>
          ))}

          <div className="flex shrink-0 items-center gap-2.5">
            {user ? (
              <>
                {user.image && (
                  <img src={user.image} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
                )}
                {user.name && <span className="hidden text-body-small text-ink-secondary sm:inline">{user.name}</span>}
                <SignOutButton />
              </>
            ) : (
              <SignInButton />
            )}
          </div>
        </div>
      </header>
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: errors only from callers of `<AppShell>` that don't yet pass `user` — fixed in the next two tasks.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth src/components/AppShell.tsx
git commit -m "feat(ui): add sign-in/sign-out to the header"
```

---

### Task 13: Dashboard + Library pages — wire `auth()`

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/library/page.tsx`

**Interfaces:**
- Consumes: `auth()` (Task 2); `getReadiness`, `getSessionHistory` (Task 7); `getDeckStats`, `loadReviewPool` (Tasks 5–6); `AppShell`'s new `user` prop (Task 12).

- [ ] **Step 1: `src/app/dashboard/page.tsx`**

Find:
```tsx
import { AppShell } from "@/components/AppShell";
import { CertificationEmptyState } from "@/components/CertificationEmptyState";
import { DomainBars } from "@/components/DomainBars";
import { HistoryTable } from "@/components/HistoryTable";
import { ModeCards } from "@/components/ModeCards";
import { ReadinessCard } from "@/components/ReadinessCard";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import type { CertificationSummary } from "@/lib/ui/types";
```

Replace with:
```tsx
import { AppShell } from "@/components/AppShell";
import { CertificationEmptyState } from "@/components/CertificationEmptyState";
import { DomainBars } from "@/components/DomainBars";
import { HistoryTable } from "@/components/HistoryTable";
import { ModeCards } from "@/components/ModeCards";
import { ReadinessCard } from "@/components/ReadinessCard";
import { auth } from "@/lib/auth";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import type { CertificationSummary } from "@/lib/ui/types";
```

Find:
```tsx
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const all = listCertifications(db).map((cert) => {
```

Replace with:
```tsx
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const all = listCertifications(db).map((cert) => {
```

Find:
```tsx
  if (!current.summary.ready) {
    const frameworkHasContentElsewhere = all.some(
      (c) => c.summary.framework.code === current.summary.framework.code && c.summary.ready,
    );
    return (
      <AppShell certifications={certifications} current={current.summary} active="dashboard">
        <CertificationEmptyState
          certification={current.summary}
          frameworkHasContentElsewhere={frameworkHasContentElsewhere}
        />
      </AppShell>
    );
  }

  const { cert } = current;
  const readiness = getReadiness(db, cert);
  const history = getSessionHistory(db, cert, 15);
  const decks = getDeckStats(db, cert.framework.id);
  const coverage = getBankCoverage(db, cert);
  const reviewPoolSize = loadReviewPool(db, cert).length;
```

Replace with:
```tsx
  if (!current.summary.ready) {
    const frameworkHasContentElsewhere = all.some(
      (c) => c.summary.framework.code === current.summary.framework.code && c.summary.ready,
    );
    return (
      <AppShell certifications={certifications} current={current.summary} active="dashboard" user={session?.user ?? null}>
        <CertificationEmptyState
          certification={current.summary}
          frameworkHasContentElsewhere={frameworkHasContentElsewhere}
        />
      </AppShell>
    );
  }

  const { cert } = current;
  const readiness = getReadiness(db, userId, cert);
  const history = getSessionHistory(db, userId, cert, 15);
  const decks = getDeckStats(db, userId, cert.framework.id);
  const coverage = getBankCoverage(db, cert);
  const reviewPoolSize = loadReviewPool(db, userId, cert).length;
```

Find:
```tsx
  return (
    <AppShell certifications={certifications} current={current.summary} active="dashboard">
      <div className="flex flex-col gap-6">
```

Replace with:
```tsx
  return (
    <AppShell certifications={certifications} current={current.summary} active="dashboard" user={session?.user ?? null}>
      <div className="flex flex-col gap-6">
```

- [ ] **Step 2: `src/app/library/page.tsx`**

Find:
```tsx
import { AppShell } from "@/components/AppShell";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";
import type { CertificationSummary } from "@/lib/ui/types";
```

Replace with:
```tsx
import { AppShell } from "@/components/AppShell";
import { auth } from "@/lib/auth";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";
import type { CertificationSummary } from "@/lib/ui/types";
```

Find:
```tsx
  const requested = (await searchParams).cert;
  const current = all.find((c) => c.code === requested) ?? all[all.length - 1];

  return (
    <AppShell certifications={all} current={current} active="library">
```

Replace with:
```tsx
  const requested = (await searchParams).cert;
  const current = all.find((c) => c.code === requested) ?? all[all.length - 1];
  const session = await auth();

  return (
    <AppShell certifications={all} current={current} active="library" user={session?.user ?? null}>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no more errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/library/page.tsx
git commit -m "feat(dashboard,library): render one code path signed in or out"
```

---

### Task 14: Flashcards page — gate the reviewer, show a logged-out message

**Files:**
- Modify: `src/app/flashcards/page.tsx`

**Interfaces:**
- Consumes: `auth()` (Task 2); `getDeckStats` (Task 5); `AppShell`'s `user` prop (Task 12).

- [ ] **Step 1: Rewrite `src/app/flashcards/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { FlashcardReviewer } from "@/components/flashcards/FlashcardReviewer";
import { auth } from "@/lib/auth";
import { DECKS, type Deck } from "@/lib/domain";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

const DECK_META: Record<Deck, { title: string; blurb: string }> = {
  techniques: { title: "Techniques", blurb: "50 kỹ thuật BABOK — mục đích & khi nào dùng" },
  tasks: { title: "Tasks", blurb: "30 task — Purpose / Inputs / Elements / Outputs" },
  glossary: { title: "Glossary", blurb: "206 thuật ngữ & định nghĩa BABOK" },
};

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string; deck?: string }>;
}) {
  const all = listCertifications(db).map((cert) => {
    const coverage = getBankCoverage(db, cert);
    const summary: CertificationSummary = {
      code: cert.code,
      name: cert.name,
      nameVi: cert.nameVi,
      body: cert.body,
      tier: cert.tier,
      accent: cert.accent,
      framework: cert.framework,
      questionCount: cert.questionCount,
      timeLimitSec: cert.timeLimitSec,
      passThresholdPercent: cert.passThresholdPercent,
      passThresholdSource: cert.passThresholdSource,
      proficiencyLabel: cert.proficiencyLabel,
      questionTypes: cert.questionTypes,
      eligibility: cert.eligibility,
      domains: cert.domains,
      availableQuestions: coverage.total,
      availableByDomain: coverage.byDomain,
      ready: coverage.total > 0,
    };
    return summary;
  });

  const params = await searchParams;
  const current =
    all.find((c) => c.code === params.cert) ?? [...all].sort((a, b) => b.availableQuestions - a.availableQuestions)[0];
  const requestedDeck = DECKS.includes(params.deck as Deck) ? (params.deck as Deck) : undefined;
  const reviewing = params.deck === "all" || requestedDeck !== undefined;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  if (reviewing && !session) {
    const callback = `/flashcards?cert=${current.code}${params.deck ? `&deck=${params.deck}` : ""}`;
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
  }

  const decks = getDeckStats(db, userId, current.framework.id);
  const totalCards = DECKS.reduce((acc, d) => acc + decks[d].total, 0);

  return (
    <AppShell certifications={all} current={current} active="flashcards" user={session?.user ?? null}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          {DECKS.map((d) => {
            const active = requestedDeck === d;
            return (
              <Link
                key={d}
                href={`/flashcards?cert=${current.code}&deck=${d}`}
                className={
                  "rounded-full px-3.5 py-1.5 text-body-small transition-colors " +
                  (active
                    ? "bg-surface-inverse text-ink-inverse"
                    : "border border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
                }
              >
                {DECK_META[d].title} ({decks[d].due}/{decks[d].total})
              </Link>
            );
          })}
          <Link
            href={`/flashcards?cert=${current.code}&deck=all`}
            className={
              "rounded-full px-3.5 py-1.5 text-body-small transition-colors " +
              (params.deck === "all"
                ? "bg-surface-inverse text-ink-inverse"
                : "border border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
            }
          >
            Tất cả
          </Link>
        </div>

        {totalCards === 0 ? (
          <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-10 text-center">
            <p className="text-heading-m text-ink-primary">Chưa có bộ thẻ nào cho {current.framework.name}</p>
            <p className="mt-2 text-body-small text-ink-secondary">
              Flashcard thuộc framework, không thuộc riêng {current.code}.
            </p>
          </section>
        ) : reviewing ? (
          <FlashcardReviewer certificationCode={current.code} deck={requestedDeck} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {DECKS.map((d) => {
              const s = decks[d];
              const meta = DECK_META[d];
              return (
                <Link
                  key={d}
                  href={`/flashcards?cert=${current.code}&deck=${d}`}
                  className="rounded-xl border border-border-subtle bg-surface-card px-6 py-5 transition-colors hover:border-border-strong"
                >
                  <h3 className="text-heading-m text-ink-primary">{meta.title}</h3>
                  <p className="mt-1 text-body-small text-ink-secondary">{meta.blurb}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-body-small">
                    {session ? (
                      <>
                        <Stat label="Đến hạn" value={s.due} tone="accent" />
                        <Stat label="Chưa học" value={s.new} tone="muted" />
                        <Stat label="Đang học" value={s.learning} tone="muted" />
                        <Stat label="Tổng" value={s.total} tone="muted" />
                      </>
                    ) : (
                      <>
                        <Stat label="Tổng" value={s.total} tone="muted" />
                        <p className="text-caption text-ink-muted">Đăng nhập để xem lịch ôn của bạn</p>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "accent" | "muted" }) {
  return (
    <div>
      <p className={"text-heading-s " + (tone === "accent" ? "text-accent-text" : "text-ink-primary")}>{value}</p>
      <p className="text-caption text-ink-muted">{label}</p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/flashcards/page.tsx
git commit -m "feat(flashcards): gate the reviewer behind sign-in, show a logged-out hint"
```

---

### Task 15: Exam + Result pages — gate behind sign-in

**Files:**
- Modify: `src/app/exam/[id]/page.tsx`
- Modify: `src/app/result/[id]/page.tsx`

**Interfaces:**
- Consumes: `auth()` (Task 2); `getSessionResult` (Task 6, ownership-checked); `AppShell`'s `user` prop (Task 12); `startSessionAction`'s `returnTo` field (Task 10).

- [ ] **Step 1: `src/app/exam/[id]/page.tsx`**

```tsx
import { redirect } from "next/navigation";

import { ExamClient } from "@/components/exam/ExamClient";
import { auth } from "@/lib/auth";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/exam/${id}`)}`);
  }
  return <ExamClient sessionId={Number(id)} />;
}
```

Ownership enforcement itself happens inside `getSessionForTaking` (Task 6, via `requireSession`) — `ExamClient`'s existing error-handling path already renders "Không tải được bài thi" for a 404 API response, which covers both "session doesn't exist" and "belongs to someone else" with the identical UI, matching the spec.

- [ ] **Step 2: `src/app/result/[id]/page.tsx`**

Find:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { startSessionAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { DomainBars } from "@/components/DomainBars";
import { ReviewList } from "@/components/result/ReviewList";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, getSessionResult } from "@/lib/exam/sessions";
import { formatMinutes } from "@/lib/ui/format";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const sessionId = Number((await params).id);
  if (!Number.isInteger(sessionId)) notFound();

  let result;
  try {
    result = getSessionResult(db, sessionId);
  } catch {
```

Replace with:
```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { startSessionAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { DomainBars } from "@/components/DomainBars";
import { ReviewList } from "@/components/result/ReviewList";
import { auth } from "@/lib/auth";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, getSessionResult } from "@/lib/exam/sessions";
import { formatMinutes } from "@/lib/ui/format";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const sessionId = Number((await params).id);
  if (!Number.isInteger(sessionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/result/${sessionId}`)}`);
  }

  let result;
  try {
    result = getSessionResult(db, session.user.id, sessionId);
  } catch {
```

Find:
```tsx
  return (
    <AppShell certifications={all} current={current} active="dashboard">
      <div className="flex flex-col gap-6">
        <section className="flex flex-wrap items-center gap-10 rounded-xl border border-border-subtle bg-surface-card px-8 py-7">
```

Replace with:
```tsx
  return (
    <AppShell certifications={all} current={current} active="dashboard" user={session.user}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-wrap items-center gap-10 rounded-xl border border-border-subtle bg-surface-card px-8 py-7">
```

Find (both `<form action={startSessionAction}>` blocks — add a `returnTo` hidden input to each):
```tsx
          {wrongCount > 0 && (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="mode" value="review" />
              <input type="hidden" name="total" value={Math.min(wrongCount, 50)} />
```

Replace with:
```tsx
          {wrongCount > 0 && (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="returnTo" value={`/result/${sessionId}`} />
              <input type="hidden" name="mode" value="review" />
              <input type="hidden" name="total" value={Math.min(wrongCount, 50)} />
```

Find:
```tsx
          rowAction={(code) => (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="mode" value="domain" />
              <input type="hidden" name="domain" value={code} />
              <input type="hidden" name="total" value={20} />
```

Replace with:
```tsx
          rowAction={(code) => (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="returnTo" value={`/result/${sessionId}`} />
              <input type="hidden" name="mode" value="domain" />
              <input type="hidden" name="domain" value={code} />
              <input type="hidden" name="total" value={20} />
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/app/exam src/app/result
git commit -m "feat(exam,result): redirect to sign-in when logged out"
```

---

### Task 16: `ExamClient.tsx` — handle a mid-exam 401

**Files:**
- Modify: `src/components/exam/ExamClient.tsx`

**Interfaces:**
- Consumes: the `/api/sessions/[id]/answers` route's new 401 response (Task 9).

- [ ] **Step 1: Extend `persistAnswer`'s error handling**

Find:
```tsx
  const persistAnswer = useCallback(
    async (questionId: number, patch: { selectedOptionId?: number; flagged?: boolean }) => {
      const res = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? "Không lưu được câu trả lời vừa rồi.");
      } else {
        setSaveError(null);
      }
    },
    [sessionId],
  );
```

Replace with:
```tsx
  const persistAnswer = useCallback(
    async (questionId: number, patch: { selectedOptionId?: number; flagged?: boolean }) => {
      const res = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, ...patch }),
      });
      if (res.status === 401) {
        setSessionExpired(true);
        setSaveError("Phiên đăng nhập hết hạn — đăng nhập lại để tiếp tục.");
      } else if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? "Không lưu được câu trả lời vừa rồi.");
      } else {
        setSaveError(null);
        setSessionExpired(false);
      }
    },
    [sessionId],
  );
```

- [ ] **Step 2: Add the `sessionExpired` state**

Find:
```tsx
  const [saveError, setSaveError] = useState<string | null>(null);
```

Replace with:
```tsx
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
```

- [ ] **Step 3: Render a sign-in link alongside the save-error banner**

Find:
```tsx
      {saveError && (
        <p className="bg-wrong-bg px-6 py-2 text-center text-body-small text-wrong-text">{saveError}</p>
      )}
```

Replace with:
```tsx
      {saveError && (
        <p className="flex items-center justify-center gap-2 bg-wrong-bg px-6 py-2 text-center text-body-small text-wrong-text">
          {saveError}
          {sessionExpired && (
            <a
              href={`/api/auth/signin?callbackUrl=${encodeURIComponent(`/exam/${sessionId}`)}`}
              className="underline"
            >
              Đăng nhập lại
            </a>
          )}
        </p>
      )}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors from this file.

- [ ] **Step 5: Commit**

```bash
git add src/components/exam/ExamClient.tsx
git commit -m "feat(exam): surface a re-sign-in link when the session cookie expires mid-exam"
```

---

### Task 17: Full regression + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: every test passes (177+ pre-existing tests plus the new isolation/401 tests from Tasks 4–9).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean, no errors anywhere in the project.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 4: Manual verification — run the dev server**

```bash
npm run dev
```

- [ ] **Step 5: Manual verification — logged-out browsing**

In a private/incognito browser window, visit `/dashboard`. Confirm: the page renders with a zeroed readiness card and empty history (not an error), the header shows "Đăng nhập với Google" instead of an avatar, and the Mode cards render normally.

- [ ] **Step 6: Manual verification — gated action redirects**

Click "Bắt đầu" on the Mock exam card. Confirm you're redirected to Google's sign-in flow. Complete it and confirm you land back on `/dashboard?cert=...` (not mid-exam) — per the spec, a logged-out click always returns to the page, never resumes the original submission automatically. Click "Bắt đầu" again now that you're signed in, and confirm a real exam session starts.

- [ ] **Step 7: Manual verification — flashcards**

Visit `/flashcards` logged out: confirm each deck card shows a total count and "Đăng nhập để xem lịch ôn của bạn" instead of due/new/learning numbers. Click a deck: confirm redirect to sign-in. Sign in, click a deck again: confirm the reviewer loads and grading a card works.

- [ ] **Step 8: Manual verification — two-account isolation**

Sign in with one Google account, complete a quick quiz, bookmark a question, review a flashcard. Sign out, sign in with a second Google account. Confirm the Dashboard, history, bookmarks, and flashcard due counts all show zero/empty for the second account — none of the first account's data appears.

- [ ] **Step 9: Manual verification — direct URL to someone else's session**

While signed in as the second account, manually navigate to `/result/<id>` using a session id that belongs to the first account. Confirm the "Bài này chưa được nộp, hoặc không tồn tại." not-found message appears — not a 403, not the first account's data.

- [ ] **Step 10: Stop the dev server; report results to the user**

No commit for this task — it's verification-only. Report the full-suite pass/fail counts, build status, and manual-verification outcomes back to the user before considering the feature done.
