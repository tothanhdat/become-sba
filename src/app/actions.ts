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
