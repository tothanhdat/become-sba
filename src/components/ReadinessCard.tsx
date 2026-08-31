import type { Readiness } from "@/lib/ui/types";

export function ReadinessCard({
  readiness,
  passThresholdPercent,
  passThresholdSource,
  weakestDomainLabels,
}: {
  readiness: Readiness;
  passThresholdPercent: number;
  passThresholdSource: string;
  weakestDomainLabels: string[];
}) {
  return (
    <section className="flex flex-wrap items-center gap-12 rounded-xl border border-border-subtle bg-surface-card px-8 py-7">
      <div>
        <p className="text-mono-label uppercase text-ink-muted">Mức sẵn sàng</p>
        <p className="text-display-score text-ink-primary">{readiness.overallPercent}%</p>
        <p className="text-body-small text-ink-secondary">
          {readiness.correct} / {readiness.answered} câu đúng
        </p>
      </div>

      <div className="flex-1">
        <span
          className={
            "inline-flex items-center rounded-md px-2.5 py-1 text-body-medium " +
            (readiness.onTrack ? "bg-correct-bg text-correct-text" : "bg-flagged-bg text-flagged-text")
          }
        >
          {readiness.onTrack ? "Đang trên đà đạt" : `Chưa đạt ngưỡng ${passThresholdPercent}%`}
        </span>
        <p className="mt-2 max-w-prose text-body-small text-ink-secondary">
          Ngưỡng {passThresholdPercent}% — {passThresholdSource}
          {weakestDomainLabels.length > 0 && <> Yếu nhất hiện tại: {weakestDomainLabels.join(", ")}.</>}
        </p>
      </div>
    </section>
  );
}
