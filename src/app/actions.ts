"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

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

/** Starts a session and takes the learner straight into it. */
export async function startSessionAction(form: FormData): Promise<void> {
  const mode = str(form, "mode") as ExamMode;
  if (!EXAM_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);

  const domain = str(form, "domain");
  const totalRaw = int(form, "total");

  const id = createSession(db, {
    certificationCode: str(form, "certificationCode"),
    mode,
    domain: domain || undefined,
    total: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined,
  });

  redirect(`/exam/${id}`);
}

export async function submitSessionAction(form: FormData): Promise<void> {
  const sessionId = int(form, "sessionId");
  submitSession(db, sessionId);
  redirect(`/result/${sessionId}`);
}

export async function saveNoteAction(form: FormData): Promise<void> {
  saveNote(db, int(form, "questionId"), str(form, "body"));
  revalidatePath(str(form, "returnTo") || "/dashboard");
}

export async function toggleBookmarkAction(form: FormData): Promise<void> {
  toggleBookmark(db, int(form, "questionId"));
  revalidatePath(str(form, "returnTo") || "/dashboard");
}

export async function reviewFlashcardAction(form: FormData): Promise<void> {
  const button = str(form, "button") as ReviewButton;
  if (!(button in REVIEW_GRADES)) throw new Error(`Unknown review button: ${button}`);
  reviewCard(db, int(form, "cardId"), button);
  revalidatePath("/flashcards");
}
