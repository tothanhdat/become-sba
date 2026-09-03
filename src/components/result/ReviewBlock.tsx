"use client";

import { useRef, useState } from "react";

import type { QuestionTranslation } from "@/lib/translate";
import type { ResultQuestion } from "@/lib/ui/types";

interface Props {
  question: ResultQuestion;
  frameworkName: string;
}

type NoteStatus = "idle" | "saving" | "saved" | "error";

/**
 * The single most important screen for learning from this app: every option's
 * rationale is always visible, never behind a "show more" — CBAP-style
 * distractors are near-misses, and reading why the near-miss is wrong is where
 * most of the learning happens.
 */
export function ReviewBlock({ question, frameworkName }: Props) {
  const [caseOpen, setCaseOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(question.bookmarked);
  const [note, setNote] = useState(question.note ?? "");
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [translation, setTranslation] = useState<QuestionTranslation | null>(null);
  const [showVi, setShowVi] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const lastSavedNote = useRef(question.note ?? "");
  const savedIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function toggleBookmark() {
    setBookmarkBusy(true);
    try {
      const res = await fetch(`/api/questions/${question.questionId}/bookmark`, { method: "POST" });
      if (res.ok) {
        const body = await res.json();
        setBookmarked(body.bookmarked);
      }
    } finally {
      setBookmarkBusy(false);
    }
  }

  async function toggleTranslate() {
    if (showVi) {
      setShowVi(false);
      return;
    }
    // Translated once, kept for the rest of the visit — the source text is fixed.
    if (translation) {
      setShowVi(true);
      return;
    }

    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/questions/${question.questionId}/translate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setTranslateError(body.error ?? "Không dịch được câu này.");
        return;
      }
      setTranslation((await res.json()) as QuestionTranslation);
      setShowVi(true);
    } catch {
      setTranslateError("Không kết nối được tới máy chủ.");
    } finally {
      setTranslating(false);
    }
  }

  async function saveNote() {
    // Skip the round trip when nothing actually changed since the last save —
    // clicking into and out of an unedited textarea shouldn't show "Đang lưu…".
    if (note === lastSavedNote.current) return;

    setNoteStatus("saving");
    try {
      const res = await fetch(`/api/questions/${question.questionId}/note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      if (!res.ok) throw new Error("save failed");

      lastSavedNote.current = note;
      setNoteStatus("saved");
      if (savedIndicatorTimeout.current) clearTimeout(savedIndicatorTimeout.current);
      savedIndicatorTimeout.current = setTimeout(() => setNoteStatus("idle"), 2500);
    } catch {
      setNoteStatus("error");
    }
  }

  const vi = showVi ? translation : null;
  const displayStem = vi?.stem ?? question.stem;
  const displayCaseStudy = vi?.caseStudy ?? question.caseStudy;
  const displayExplanation = vi?.explanation ?? question.explanation;
  const viOption = (label: string) => vi?.options.find((o) => o.label === label);

  return (
    <article className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
      <header
        className={
          "flex flex-wrap items-center gap-2.5 border-b border-border-subtle px-6 py-3.5 " +
          (question.isCorrect ? "bg-correct-bg" : "bg-wrong-bg")
        }
      >
        <h3 className="text-heading-s text-ink-primary">Câu {question.position}</h3>
        <Chip tone={question.isCorrect ? "correct" : "wrong"}>
          {question.isCorrect ? "✓ ĐÚNG" : "✗ SAI"}
        </Chip>
        <Chip tone="neutral">{question.domain}</Chip>
        <Chip tone="neutral" title={question.sourceTask}>
          {frameworkName} {question.sourceRef}
        </Chip>

        <button
          type="button"
          onClick={() => void toggleTranslate()}
          disabled={translating}
          className="ml-auto rounded-md border border-border-strong bg-surface-card px-2.5 py-1 text-body-small text-ink-secondary transition-colors hover:bg-surface-sunken disabled:opacity-60"
        >
          {translating ? "Đang dịch…" : showVi ? "Hiển thị văn bản gốc" : "Dịch sang tiếng Việt"}
        </button>

        <button
          type="button"
          onClick={toggleBookmark}
          disabled={bookmarkBusy}
          className={
            "rounded-md border px-2.5 py-1 text-body-small transition-colors disabled:opacity-60 " +
            (bookmarked
              ? "border-flagged-border bg-flagged-bg text-flagged-text"
              : "border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
          }
        >
          {bookmarked ? "🔖 Đã bookmark" : "🔖 Bookmark"}
        </button>
      </header>

      <div className="flex flex-col gap-4 px-6 py-5">
        {translateError && <p className="text-body-small text-wrong-text">{translateError}</p>}

        {displayCaseStudy && (
          <div className="rounded-lg border-l-[3px] border-border-strong bg-surface-sunken px-4 py-3">
            <button type="button" onClick={() => setCaseOpen((v) => !v)} className="flex items-center gap-2 text-left">
              <span className="text-body-small text-ink-muted">{caseOpen ? "▾" : "▸"}</span>
              <span className="text-mono-label uppercase text-ink-muted">Case study</span>
              <span className="text-body-medium text-ink-primary">{displayCaseStudy.title}</span>
            </button>
            {caseOpen && (
              <p className="mt-2 text-body-small leading-relaxed text-ink-secondary">{displayCaseStudy.body}</p>
            )}
          </div>
        )}

        <p className="text-body-default leading-relaxed text-ink-primary">{displayStem}</p>

        <div className="flex flex-col gap-2.5">
          {question.options.map((opt) => {
            const isChosenWrong = question.selectedOptionId === opt.id && !opt.isCorrect;
            const tone = opt.isCorrect ? "correct" : isChosenWrong ? "wrong" : "neutral";
            return (
              <div
                key={opt.id}
                className={
                  "rounded-lg border px-4 py-3.5 " +
                  (tone === "correct"
                    ? "border-correct-border bg-correct-bg"
                    : tone === "wrong"
                      ? "border-wrong-border bg-wrong-bg"
                      : "border-border-subtle bg-surface-card")
                }
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold " +
                      (tone === "correct"
                        ? "bg-correct-border text-ink-inverse"
                        : tone === "wrong"
                          ? "bg-wrong-border text-ink-inverse"
                          : "bg-surface-sunken text-ink-secondary")
                    }
                  >
                    {tone === "correct" ? "✓" : tone === "wrong" ? "✗" : opt.label}
                  </span>
                  <p className="text-body-default text-ink-primary">
                    {opt.label}. {viOption(opt.label)?.text ?? opt.text}
                  </p>
                  {tone === "correct" && <Chip tone="correct">ĐÁP ÁN ĐÚNG</Chip>}
                  {tone === "wrong" && <Chip tone="wrong">BẠN CHỌN</Chip>}
                </div>
                <p className="mt-1.5 pl-[34px] text-body-small text-ink-secondary">
                  {viOption(opt.label)?.rationale ?? opt.rationale}
                </p>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-accent-soft px-4 py-3.5">
          <p className="text-mono-label uppercase text-accent-text">Giải thích</p>
          <p className="mt-1 text-body-default text-ink-primary">{displayExplanation}</p>
        </div>

        <div>
          <p className="text-mono-label uppercase text-ink-muted">Ghi chú của bạn</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            rows={2}
            placeholder="Viết ghi chú riêng cho câu này…"
            className="mt-1.5 w-full resize-y rounded-lg border border-border-strong bg-surface-card px-3.5 py-2.5 text-body-default text-ink-primary placeholder:text-ink-muted focus:border-accent-solid focus:outline-none"
          />
          <p
            className={
              "mt-1 flex items-center gap-1 text-caption " +
              (noteStatus === "error" ? "text-wrong-text" : noteStatus === "saved" ? "text-correct-text" : "text-ink-muted")
            }
          >
            {noteStatus === "saving" && "Đang lưu…"}
            {noteStatus === "saved" && (
              <>
                <span aria-hidden>✓</span> Đã lưu
              </>
            )}
            {noteStatus === "error" && "Không lưu được — thử rời ô nhập lại."}
            {noteStatus === "idle" && "Tự lưu khi rời ô nhập. Để trống để xoá ghi chú."}
          </p>
        </div>
      </div>
    </article>
  );
}

function Chip({ tone, children, title }: { tone: "correct" | "wrong" | "neutral"; children: React.ReactNode; title?: string }) {
  const cls =
    tone === "correct"
      ? "bg-correct-border text-ink-inverse"
      : tone === "wrong"
        ? "bg-wrong-border text-ink-inverse"
        : "border border-border-strong bg-surface-card text-ink-secondary";
  return (
    <span title={title} className={"rounded-md px-2 py-0.5 text-mono-label " + cls}>
      {children}
    </span>
  );
}
