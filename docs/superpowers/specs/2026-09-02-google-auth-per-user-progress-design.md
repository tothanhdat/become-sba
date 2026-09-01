# Google login + per-user progress — Design

**Date:** 2026-09-02
**Status:** Approved by user in chat, pending spec review

## Context

BA Prep started as a single-learner app: one SQLite file, no `users` table,
every exam session/note/bookmark/flashcard-state was global. The app is about
to be deployed to Railway with a public domain and shared with other
learners. Without per-user data, two people using the same deployment would
see and overwrite each other's progress. This spec adds Google sign-in and
scopes every piece of personal data to the signed-in user.

Deployment to Railway was in progress (domain requested: `become-sba`) when
this requirement came up. Deployment resumes after this ships, since
deploying the single-user version now would need re-doing once auth lands.

## Goals

- Google OAuth sign-in, no other providers for now.
- Every learner's progress (sessions, scores, notes, bookmarks, flashcard
  SM-2 state) is private to them — no cross-user visibility, no leaderboard.
- Browsing (Dashboard, Library, the certification blueprint, domain
  breakdown) works **without** signing in — it just shows an empty/zero
  state, identical to a brand-new signed-in user's state.
- Anything that writes personal progress (starting a session, answering,
  submitting, taking notes, bookmarking, grading a flashcard) requires
  sign-in. A logged-out learner who tries is sent to Google sign-in and
  lands back on the page they were on — not automatically re-submitting
  their original click.
- Open sign-up: any Google account may sign in. No invite list, no domain
  restriction.

## Non-goals

- No other auth providers (email/password, GitHub, etc.) — trivial to add
  later since NextAuth's provider list is just an array, but not built now.
- No admin view, no cross-user comparison, no leaderboard.
- No migration of existing progress data. `npm run reset` was already run
  before this work started, so `exam_sessions`, `user_notes`, `bookmarks`,
  `flashcard_states`, and `flashcard_reviews` — the five tables gaining
  `userId` — are already empty; there is no anonymous data to migrate to a
  placeholder user. The question bank, decks, and catalog tables are
  untouched by this change (they carry no `userId`) and don't need
  reseeding on account of it — the local db is rebuilt for the schema
  change and then `npm run seed` restores content as it always does.
- No global `middleware.ts` blanket-redirect. Gating happens per route/action
  (see "Public vs protected" below) — a blanket gate would contradict the
  "browsing works without login" goal.

## Architecture

**NextAuth.js (Auth.js v5) + `@auth/drizzle-adapter`, database session
strategy, Google provider only.**

Chosen over rolling a custom OAuth flow (real security surface to get right:
PKCE, state, token verification, cookie flags) and over a hosted auth SaaS
(Clerk/Supabase Auth/Auth0 — adds an external dependency and likely cost for
no benefit, since the app already owns a SQLite database perfectly capable of
holding auth state). Auth.js v5's `auth()` helper works uniformly in Server
Components, Route Handlers, and Server Actions, which fits this app's mix of
all three.

Session strategy is **database**, not JWT — sessions live in the same SQLite
file as everything else, consistent with the app's "just SQLite" design and
with the Railway Volume already planned for persistence.

## Data model

New tables, shaped to what `@auth/drizzle-adapter` expects for SQLite
(`users`, `accounts`, `sessions`, `verificationTokens`). `verificationTokens`
is unused (no email/magic-link flow) but kept for adapter compatibility.

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
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  { identifier: text("identifier").notNull(), token: text("token").notNull(), expires: integer("expires", { mode: "timestamp_ms" }).notNull() },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
```

`sessions` here is Auth.js's own table (session tokens/cookies) — a
different concept from this app's `exam_sessions` (a mock exam attempt).
No naming collision since the existing table is already named
`exam_sessions`, not `sessions`.

Changes to existing tables (all `userId` columns are `text` referencing
`users.id`, `onDelete: "cascade"` — deleting a user drops their data):

| Table | Change |
|---|---|
| `exam_sessions` | add `userId` (**not null**) |
| `user_notes` | add `userId`; primary key becomes `(questionId, userId)` |
| `bookmarks` | add `userId`; primary key becomes `(questionId, userId)` |
| `flashcard_states` | add `userId`; primary key becomes `(cardId, userId)` |
| `flashcard_reviews` | add `userId` (log table, no PK change) |
| `session_questions` | **no change** — owned transitively via `exam_sessions.userId` |

## Public vs protected

| Surface | Logged out | Logged in |
|---|---|---|
| `/dashboard`, `/library` | Renders normally; readiness/history/decks come back zeroed (same shape as a fresh user) | Real data, scoped to the user |
| "Bắt đầu" / "Ôn flashcard" mode-card actions | Redirect to Google sign-in, `callbackUrl` = current page | Creates the session / opens the reviewer |
| `/exam/[id]` | Redirect to sign-in | Renders **only if** the session's `userId` matches the caller; otherwise same not-found UI as a nonexistent session |
| `/result/[id]` | Redirect to sign-in | Same ownership check as above |
| `/flashcards` deck picker | Renders; shows each deck's total card count. Due/new/learning are per-user (SM-2 state), so in place of those numbers the card shows one line — "Đăng nhập để xem lịch ôn của bạn" — rather than a zero, which would misleadingly read as "nothing due" | Real due/new/learning counts |
| `/flashcards?deck=...` reviewer | Redirect to sign-in | Grades write to `flashcard_states`/`flashcard_reviews` scoped to the user |
| Note / bookmark actions | Unreachable (only exposed from `/result/[id]`, which already gates) | Scoped to the user |

"Session belongs to someone else" is treated identically to "session doesn't
exist" — same UI, same behavior — so a guessed session ID can't be used to
probe whether it belongs to another user.

"Redirect to sign-in, land back on the same page" means the **page**, not a
replay of the original form submission — after signing in the learner clicks
"Bắt đầu" again. Trying to resume the exact in-flight Server Action across an
OAuth round trip isn't worth the complexity for one extra click.

## Authorization boundary

`userId` is **never** accepted from client input. Every mutating API route
and Server Action calls `auth()` server-side and uses `session.user.id`.
Read functions in `lib/*` take `userId: string | null`; when `null` they
short-circuit to an empty/zero result without touching the database — this
is what lets Dashboard render one code path whether or not the visitor is
signed in. Write functions require a non-null `userId`; called with `null`
they throw (defensive — should be unreachable, since the route/action layer
gates before ever calling them, but `userId` crossing this boundary is
exactly the kind of thing worth checking rather than trusting).

`requireSession` in `lib/exam/sessions.ts` currently checks only that a
session exists; it gains an ownership check (`session.userId === userId`),
throwing the same "does not exist" error for both "no such session" and
"exists but isn't yours" — one error shape, so the API layer's existing
404-mapping in `errorResponse` (`src/app/api/_http.ts`) needs no changes.

## Files touched

- `src/lib/db/schema.ts` — new tables + `userId` columns above.
- `src/lib/auth.ts` (new) — NextAuth config: Google provider, Drizzle adapter
  bound to the existing `db` export, database session strategy.
- `src/app/api/auth/[...nextauth]/route.ts` (new) — the Auth.js route handler.
- Every function in `src/lib/exam/sessions.ts`, `src/lib/analytics.ts`,
  `src/lib/notes.ts`, `src/lib/srs/decks.ts` gains a `userId` parameter and a
  `WHERE user_id = ?` clause. `getBankCoverage` (catalog eligibility, not
  personal data) is unchanged.
- `src/app/actions.ts` — each Server Action calls `auth()` first; redirects
  to sign-in on missing session before doing anything else.
- Every route under `src/app/api/` that touches personal data — replace
  "trust nothing, derive nothing" with `const session = await auth()`,
  401 (via a new `unauthorized()` helper in `_http.ts`) if absent.
- `src/app/dashboard/page.tsx`, `src/app/library/page.tsx`,
  `src/app/flashcards/page.tsx` — call `auth()`, pass `session?.user?.id ??
  null` through.
- `src/app/exam/[id]/page.tsx`, `src/app/result/[id]/page.tsx` — call
  `auth()`; redirect to sign-in if absent; ownership check before rendering.
- `src/components/AppShell.tsx` — sign-in / avatar + sign-out in the header.
- `src/components/auth/SignInButton.tsx`, `SignOutButton.tsx` (new) — small
  client components wrapping Auth.js's `signIn("google", { callbackUrl })`
  and `signOut()`. No intermediate provider-picker page needed for one
  provider.
- `src/test-support/bank.ts` — add a `createTestUser` helper.
- `.env.local` (not committed) — `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`.

## Error handling

- **OAuth failure / user cancels Google consent** — Auth.js redirects back
  to the app with an `error` query param on its own; no custom handling
  needed, the learner just isn't signed in and public pages still work.
- **Session cookie expired mid-exam** — the next `PATCH
  /api/sessions/:id/answers` returns 401; `ExamClient` catches this
  (extending its existing `saveError` handling) and shows "Phiên đăng nhập
  hết hạn — đăng nhập lại để tiếp tục", with a link back to sign-in
  (`callbackUrl` = the exam URL, so they land back on the same in-progress
  exam after signing back in — the session and its answers are untouched,
  only the auth cookie expired).
- **Accessing another user's session/result** — treated as not-found, per
  the table above.
- **Sign-out** — clears the Auth.js session; the learner lands back on
  `/dashboard`, which renders its already-existing empty state.

## Testing

- Extend all touched `lib/*` tests to pass a `userId` (add a
  `createTestUser` helper to `src/test-support/bank.ts` returning a fixed
  test user id, no real OAuth involved).
- New isolation tests — the important new coverage: create two users, verify
  user A can never read or mutate user B's exam sessions, notes, bookmarks,
  or flashcard state, and that `loadReviewPool`/`getDueCards`/`getReadiness`
  for user A never include user B's data.
- New API tests: every mutating route returns 401 with no session; every
  session-scoped route returns "not found" for a session owned by a
  different user.
- The OAuth handshake itself is not tested — it's Google's flow plus
  Auth.js's own well-tested internals, not app logic.

## Deployment note

Railway needs `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and
`AUTH_URL` (the production domain) as environment variables, plus a Google
Cloud Console redirect URI for `https://<railway-domain>/api/auth/callback/google`
alongside the existing `http://localhost:3000/...` one for local dev. This
reinforces the earlier Volume decision: user accounts and sessions now live
in the same SQLite file as everything else, so losing the file on redeploy
would sign everyone out and wipe every account, not just exam progress.
