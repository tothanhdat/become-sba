"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { EXAM_MODES, REVIEW_GRADES, type ExamMode, type ReviewButton } from "@/lib/domain";
import { createSession, saveAnswer, submitSession } from "@/lib/exam/sessions";
import { saveNote, toggleBookmark } from "@/lib/notes";
import { reviewCard } from "@/lib/srs/decks";

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

function int(form: FormData, key: string): number {
  return Number(str(form, key));
}

export async function startSession(form: FormData): Promise<void> {
  const mode = str(form, "mode") as ExamMode;
  if (!EXAM_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);

  const domain = str(form, "domain");
  const totalRaw = int(form, "total");

  const id = createSession(db, {
    certificationCode: str(form, "certification"),
    mode,
    domain: domain || undefined,
    total: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined,
  });

  redirect(`/debug/session/${id}`);
}

export async function answer(form: FormData): Promise<void> {
  const sessionId = int(form, "sessionId");
  saveAnswer(db, sessionId, int(form, "questionId"), { selectedOptionId: int(form, "optionId") });
  revalidatePath(`/debug/session/${sessionId}`);
}

export async function flag(form: FormData): Promise<void> {
  const sessionId = int(form, "sessionId");
  saveAnswer(db, sessionId, int(form, "questionId"), { flagged: str(form, "flagged") === "1" });
  revalidatePath(`/debug/session/${sessionId}`);
}

export async function submit(form: FormData): Promise<void> {
  const sessionId = int(form, "sessionId");
  submitSession(db, sessionId);
  redirect(`/debug/result/${sessionId}`);
}

export async function note(form: FormData): Promise<void> {
  saveNote(db, int(form, "questionId"), str(form, "body"));
  revalidatePath(str(form, "returnTo") || "/debug");
}

export async function bookmark(form: FormData): Promise<void> {
  toggleBookmark(db, int(form, "questionId"));
  revalidatePath(str(form, "returnTo") || "/debug");
}

export async function grade(form: FormData): Promise<void> {
  const button = str(form, "button") as ReviewButton;
  if (!(button in REVIEW_GRADES)) throw new Error(`Unknown review button: ${button}`);
  reviewCard(db, int(form, "cardId"), button);
  revalidatePath("/debug/flashcards");
}
