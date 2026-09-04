"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ACCENT_SOLID_BG } from "@/lib/ui/accent";
import { formatDuration } from "@/lib/ui/format";
import type { QuestionTranslation, TakingQuestion, TakingView } from "@/lib/ui/types";

import { CaseStudyBlock } from "./CaseStudyBlock";
import { QuestionPalette } from "./QuestionPalette";

const MODE_LABEL: Record<string, string> = {
  mock: "Mock exam",
  domain: "Luyện theo domain",
  quick: "Quick quiz",
  review: "Ôn câu sai",
};

export function ExamClient({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [view, setView] = useState<TakingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collapsedCases, setCollapsedCases] = useState<Set<string>>(new Set());
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translationCache, setTranslationCache] = useState<Map<number, QuestionTranslation>>(new Map());
  const submittedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Không tải được bài thi (HTTP ${res.status})`);
        return;
      }
      const data = body as TakingView;
      if (data.session.submittedAt !== null) {
        router.replace(`/result/${sessionId}`);
        return;
      }
      setView(data);
    } catch {
      setError("Không kết nối được tới máy chủ.");
    }
  }, [sessionId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Countdown clock. Only ticks when the certification's mock exam has a time limit.
  useEffect(() => {
    if (!view?.session.timeLimitSec) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view?.session.timeLimitSec]);

  const deadline =
    view?.session.timeLimitSec != null ? view.session.startedAt + view.session.timeLimitSec * 1000 : null;
  const remainingSec = deadline !== null ? Math.max(0, Math.round((deadline - now) / 1000)) : null;

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" });
    if (res.ok) {
      router.push(`/result/${sessionId}`);
    } else {
      submittedRef.current = false;
      setSubmitting(false);
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Không nộp được bài. Thử lại.");
    }
  }, [sessionId, router]);

  // Auto-submit the instant the clock reaches zero.
  useEffect(() => {
    if (remainingSec === 0 && view) void submit();
  }, [remainingSec, view, submit]);

  const questions = view?.questions ?? [];
  const current = questions[index];

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

  const selectOption = useCallback(
    (optionId: number) => {
      if (!current) return;
      setView((prev) => (prev ? updateQuestion(prev, current.questionId, { selectedOptionId: optionId }) : prev));
      void persistAnswer(current.questionId, { selectedOptionId: optionId });
    },
    [current, persistAnswer],
  );

  const toggleFlag = useCallback(() => {
    if (!current) return;
    const next = !current.flagged;
    setView((prev) => (prev ? updateQuestion(prev, current.questionId, { flagged: next }) : prev));
    void persistAnswer(current.questionId, { flagged: next });
  }, [current, persistAnswer]);

  // Each question starts back in English; a translation you already fetched
  // for a question stays cached, so flipping back to it is instant.
  useEffect(() => {
    setTranslated(false);
    setTranslateError(null);
  }, [current?.questionId]);

  const toggleTranslate = useCallback(async () => {
    if (!current) return;
    if (translated) {
      setTranslated(false);
      return;
    }
    if (translationCache.has(current.questionId)) {
      setTranslated(true);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/questions/${current.questionId}/translate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTranslateError(body.error ?? "Không dịch được câu này.");
        return;
      }
      const translation = body as QuestionTranslation;
      setTranslationCache((prev) => new Map(prev).set(current.questionId, translation));
      setTranslated(true);
    } catch {
      setTranslateError("Không kết nối được tới máy chủ.");
    } finally {
      setTranslating(false);
    }
  }, [current, translated, translationCache]);

  const goTo = useCallback(
    (position: number) => {
      const i = questions.findIndex((q) => q.position === position);
      if (i >= 0) setIndex(i);
      setPaletteOpen(false);
    },
    [questions],
  );

  const confirmAndSubmit = useCallback(() => {
    const unanswered = questions.filter((q) => q.selectedOptionId === null).length;
    const message =
      unanswered > 0
        ? `Bạn còn ${unanswered} câu chưa trả lời. Nộp bài ngay?`
        : "Bạn đã trả lời hết. Nộp bài ngay?";
    if (window.confirm(message)) void submit();
  }, [questions, submit]);

  // Keyboard shortcuts: arrows navigate, 1-4 pick an option, F flags.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(questions.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (["1", "2", "3", "4"].includes(e.key)) {
        const opt = current.options[Number(e.key) - 1];
        if (opt) selectOption(opt.id);
      } else if (e.key.toLowerCase() === "f") {
        toggleFlag();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, questions.length, selectOption, toggleFlag]);

  const caseKey = current?.caseStudy?.title ?? null;
  const caseOpen = caseKey ? !collapsedCases.has(caseKey) : false;
  const toggleCase = () => {
    if (!caseKey) return;
    setCollapsedCases((prev) => {
      const next = new Set(prev);
      if (next.has(caseKey)) next.delete(caseKey);
      else next.add(caseKey);
      return next;
    });
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-xl border border-wrong-border bg-wrong-bg px-6 py-5 text-center">
          <p className="text-body-default text-wrong-text">{error}</p>
          <a href="/dashboard" className="mt-3 inline-block text-body-small text-accent-text underline">
            Về trang chủ
          </a>
        </div>
      </div>
    );
  }

  if (!view || !current) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-body-default text-ink-muted">Đang tải bài thi…</p>
      </div>
    );
  }

  const accentBg = ACCENT_SOLID_BG[view.session.accent];
  const urgency =
    remainingSec === null ? "normal" : remainingSec <= 300 ? "urgent" : remainingSec <= 900 ? "warn" : "normal";

  const activeTranslation = translated ? translationCache.get(current.questionId) : undefined;
  const displayStem = activeTranslation?.stem ?? current.stem;
  const displayCaseStudy = activeTranslation?.caseStudy ?? current.caseStudy;
  const displayOptions = activeTranslation
    ? current.options.map((opt) => ({
        ...opt,
        // Joined on option id, never on label: `opt.label` is this session's
        // shuffled display letter, while the translation keeps canonical labels.
        text: activeTranslation.options.find((o) => o.id === opt.id)?.text ?? opt.text,
      }))
    : current.options;

  return (
    <div className="min-h-screen bg-ground pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-border-subtle bg-surface-card/95 px-6 py-3 backdrop-blur">
        <p className="text-heading-s text-ink-primary">
          Câu {current.position} / {questions.length}
        </p>
        <p className="hidden text-caption text-ink-muted sm:block">
          {MODE_LABEL[view.session.mode] ?? view.session.mode}
          {view.session.domain ? ` · ${view.session.domain}` : ""}
        </p>

        {remainingSec !== null && (
          <div
            className={
              "ml-auto flex items-center gap-2 rounded-lg px-3.5 py-1.5 " +
              (urgency === "urgent"
                ? "bg-wrong-bg text-wrong-text"
                : urgency === "warn"
                  ? "bg-flagged-bg text-flagged-text"
                  : "bg-surface-sunken text-ink-primary")
            }
          >
            <span className="text-mono-label uppercase">Còn lại</span>
            <span className="text-heading-s tabular-nums">{formatDuration(remainingSec)}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-body-small text-ink-primary lg:hidden"
        >
          Bảng câu hỏi
        </button>

        <button
          type="button"
          onClick={confirmAndSubmit}
          disabled={submitting}
          className={"rounded-lg px-4 py-1.5 text-body-medium text-ink-inverse disabled:opacity-60 " + accentBg + (remainingSec !== null ? "" : " ml-auto")}
        >
          {submitting ? "Đang nộp…" : "Nộp bài"}
        </button>
      </header>

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

      <div className="mx-auto mt-6 flex max-w-[1040px] items-start gap-8 px-6">
        {/*
          Collapsing the palette (feedback: "cân nhắc thêm tính năng thu gọn để
          mở rộng không gian đọc") widens the reading column from the spec's
          760px cap to ~920px — a real gain for long case studies, short of
          removing the readability cap altogether.
        */}
        <div className={"flex-1 transition-[max-width] " + (paletteCollapsed ? "max-w-[920px]" : "max-w-prose")}>
          <section className="flex flex-col gap-5 rounded-xl border border-border-subtle bg-surface-card p-6">
            {displayCaseStudy && (
              <CaseStudyBlock
                title={displayCaseStudy.title}
                body={displayCaseStudy.body}
                open={caseOpen}
                onToggle={toggleCase}
              />
            )}

            <div className="flex items-center gap-2">
              <span className="rounded bg-surface-sunken px-2 py-0.5 text-caption text-ink-secondary">
                {current.domain} — {current.domainName}
              </span>
              {current.flagged && (
                <span className="rounded bg-flagged-bg px-2 py-0.5 text-caption text-flagged-text">
                  Đã đánh dấu
                </span>
              )}
            </div>

            <p className="text-body-default leading-relaxed text-ink-primary">{displayStem}</p>

            <div className="flex flex-col gap-2.5">
              {displayOptions.map((opt) => {
                const selected = current.selectedOptionId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectOption(opt.id)}
                    className={
                      "flex items-start gap-3.5 rounded-lg border px-4 py-3.5 text-left transition-colors " +
                      (selected
                        ? "border-accent-solid bg-accent-soft"
                        : "border-border-subtle bg-surface-card hover:border-border-strong hover:bg-surface-sunken")
                    }
                  >
                    <span
                      className={
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-heading-s " +
                        (selected ? accentBg + " text-ink-inverse" : "bg-surface-sunken text-ink-secondary")
                      }
                    >
                      {opt.label}
                    </span>
                    <span className="pt-0.5 text-body-default text-ink-primary">{opt.text}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={toggleFlag}
                className={
                  "rounded-lg border px-3.5 py-2 text-body-small transition-colors " +
                  (current.flagged
                    ? "border-flagged-border bg-flagged-bg text-flagged-text"
                    : "border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
                }
              >
                {current.flagged ? "Bỏ đánh dấu" : "Đánh dấu để xem lại"}
              </button>

              <button
                type="button"
                onClick={() => void toggleTranslate()}
                disabled={translating}
                className="rounded-lg border border-border-strong bg-surface-card px-3.5 py-2 text-body-small text-ink-secondary transition-colors hover:bg-surface-sunken disabled:opacity-60"
              >
                {translating ? "Đang dịch…" : translated ? "Hiển thị văn bản gốc" : "Dịch sang tiếng Việt"}
              </button>
            </div>

            {translateError && <p className="text-body-small text-wrong-text">{translateError}</p>}
          </section>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="rounded-lg border border-border-strong px-4 py-2 text-body-small text-ink-primary disabled:opacity-40"
            >
              ← Câu trước
            </button>
            <p className="hidden text-caption text-ink-muted sm:block">
              Phím tắt: ← → chuyển câu · 1-4 chọn đáp án · F đánh dấu
            </p>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
              disabled={index === questions.length - 1}
              className="rounded-lg border border-border-strong px-4 py-2 text-body-small text-ink-primary disabled:opacity-40"
            >
              Câu sau →
            </button>
          </div>
        </div>

        <aside className={"hidden shrink-0 lg:block " + (paletteCollapsed ? "w-12" : "w-[260px]")}>
          <div className="sticky top-20">
            <QuestionPalette
              questions={questions}
              currentPosition={current.position}
              onJump={goTo}
              collapsed={paletteCollapsed}
              onToggleCollapse={() => setPaletteCollapsed((v) => !v)}
            />
          </div>
        </aside>
      </div>

      {paletteOpen && (
        <div className="fixed inset-0 z-30 flex justify-end bg-surface-inverse/40 lg:hidden">
          <div className="h-full w-[300px] overflow-y-auto bg-ground p-4">
            <button
              type="button"
              onClick={() => setPaletteOpen(false)}
              className="mb-3 text-body-small text-ink-secondary"
            >
              Đóng ✕
            </button>
            <QuestionPalette questions={questions} currentPosition={current.position} onJump={goTo} />
          </div>
        </div>
      )}
    </div>
  );
}

function updateQuestion(
  view: TakingView,
  questionId: number,
  patch: Partial<Pick<TakingQuestion, "selectedOptionId" | "flagged">>,
): TakingView {
  return {
    ...view,
    questions: view.questions.map((q) => (q.questionId === questionId ? { ...q, ...patch } : q)),
  };
}
