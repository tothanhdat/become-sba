import type { HistoryEntry } from "@/lib/ui/types";

/**
 * A small inline sparkline of Mock exam scores over time — BAs preparing for a
 * professional exam care about trend more than any single attempt, and a
 * static history table doesn't show that at a glance.
 */
export function ScoreTrend({
  history,
  passThresholdPercent,
}: {
  history: HistoryEntry[];
  passThresholdPercent: number;
}) {
  // getSessionHistory returns newest first; a trend reads left-to-right oldest first.
  const attempts = history.filter((h) => h.mode === "mock").slice().reverse();
  if (attempts.length < 2) return null;

  const W = 100;
  const H = 36;
  const PAD = 4;
  const stepX = (W - PAD * 2) / (attempts.length - 1);
  const y = (pct: number) => H - PAD - (Math.min(100, pct) / 100) * (H - PAD * 2);

  const points = attempts.map((a, i) => ({ x: PAD + i * stepX, y: y(a.percent), attempt: a }));
  const path = points.map((p, i) => (i === 0 ? "M" : "L") + `${p.x},${p.y}`).join(" ");
  const thresholdY = y(passThresholdPercent);

  const first = attempts[0].percent;
  const last = attempts[attempts.length - 1].percent;
  // Round off IEEE-754 noise: 32.2 - 28.9 is 3.3000000000000043 in JS.
  const delta = Math.round((last - first) * 10) / 10;

  return (
    // A fixed 160px svg plus its text block don't reliably fit side by side
    // under ~340px of content width, which a phone's card padding eats into
    // fast — stack them on mobile instead of trusting flex-shrink on an svg.
    <div className="mb-5 flex flex-col gap-3 rounded-lg bg-surface-sunken px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-9 w-40 shrink-0">
        <line
          x1={PAD}
          y1={thresholdY}
          x2={W - PAD}
          y2={thresholdY}
          stroke="#C7C7C0"
          strokeWidth={1}
          strokeDasharray="2,2"
          vectorEffect="non-scaling-stroke"
        />
        <path d={path} fill="none" stroke="#3A5A78" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.6}
            fill={p.attempt.passed ? "#5C9E6B" : "#C0665E"}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              Mock #{i + 1}: {p.attempt.percent}% ({p.attempt.passed ? "Đạt" : "Chưa đạt"})
            </title>
          </circle>
        ))}
      </svg>

      <div>
        <p className="text-body-small text-ink-secondary">
          Xu hướng {attempts.length} lần thi mock gần nhất
        </p>
        <p className="text-body-medium text-ink-primary">
          {first}% → {last}%{" "}
          <span className={delta > 0 ? "text-correct-text" : delta < 0 ? "text-wrong-text" : "text-ink-muted"}>
            ({delta > 0 ? "+" : ""}
            {delta} điểm phần trăm)
          </span>
        </p>
      </div>
    </div>
  );
}
