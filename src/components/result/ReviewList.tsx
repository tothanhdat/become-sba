"use client";

import { useMemo, useState } from "react";

import type { ResultQuestion } from "@/lib/ui/types";

import { ReviewBlock } from "./ReviewBlock";

type Filter = "wrong" | "flagged" | "unanswered" | "all";

const FILTERS: { key: Filter; label: (q: ResultQuestion[]) => string }[] = [
  { key: "wrong", label: (qs) => `Chỉ câu sai (${qs.filter((q) => !q.isCorrect).length})` },
  { key: "flagged", label: (qs) => `Đã đánh dấu (${qs.filter((q) => q.flagged).length})` },
  { key: "unanswered", label: (qs) => `Bỏ trống (${qs.filter((q) => q.selectedOptionId === null).length})` },
  { key: "all", label: (qs) => `Tất cả (${qs.length})` },
];

export function ReviewList({ questions, frameworkName }: { questions: ResultQuestion[]; frameworkName: string }) {
  const [filter, setFilter] = useState<Filter>("wrong");

  const filtered = useMemo(() => {
    switch (filter) {
      case "wrong":
        return questions.filter((q) => !q.isCorrect);
      case "flagged":
        return questions.filter((q) => q.flagged);
      case "unanswered":
        return questions.filter((q) => q.selectedOptionId === null);
      default:
        return questions;
    }
  }, [questions, filter]);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-heading-m text-ink-primary">Xem lại từng câu</h2>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={
              "rounded-full px-3.5 py-1.5 text-body-small transition-colors " +
              (filter === f.key
                ? "bg-surface-inverse text-ink-inverse"
                : "border border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
            }
          >
            {f.label(questions)}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-border-subtle bg-surface-card px-6 py-8 text-center text-body-small text-ink-muted">
            Không có câu nào trong bộ lọc này.
          </p>
        ) : (
          filtered.map((q) => <ReviewBlock key={q.questionId} question={q} frameworkName={frameworkName} />)
        )}
      </div>
    </section>
  );
}
