# Backlog

Feedback from a user-perspective walkthrough of the app (2026-09-04). Not
committed to any timeline — a running list to pull from.

## 1. "Thư viện" nav item leads to a stub page

`/library` renders a single paragraph admitting the feature isn't built: it
needs a `GET /api/questions` endpoint with domain/bookmark/note filtering,
which doesn't exist yet. Linking to it from the main nav is the worst kind
of dead end a user can hit.

**Fix (this pass):** hide the "Thư viện câu hỏi" link from `AppShell`'s nav
until the real page exists. The route and page stay in place, just
unlinked.

**Later:** build the actual feature — `GET /api/questions` with filters
(domain, bookmarked, has-note), backing a real browse/search UI.

Status: **done** — nav link removed.

## 2. No way to find a specific question by keyword or BABOK task

You can practice a whole domain (20 random questions) or wait for a
question to land in "Ôn câu sai", but there's no way to search by keyword
or jump straight to questions tagged with a specific `sourceTask`. Depends
on #1's real library existing first.

## 3. "Ôn câu sai" has no spaced-repetition scheduling

Flashcards use real SM-2 (`src/components/flashcards/FlashcardReviewer.tsx`,
`src/lib/srs/sm2.ts`): graded Forget/Hard/Good/Easy, scheduled intervals.
The exam wrong-answer pool (`loadReviewPool` in `src/lib/exam/sessions.ts`)
is just "wrong on the most recent graded attempt" — answer it right once
and it's gone, no notion of durable recall. Two features solving the same
problem (did I actually learn this?) with very different rigor.

## 4. No quick jump between questions during an exam, on desktop

The exam header shows "Câu X / Y" and Prev/Next only. The "Bảng câu hỏi"
palette button is `lg:hidden` — desktop users have no equivalent. Flagging
5 questions to revisit means stepping through Prev/Next sequentially.
