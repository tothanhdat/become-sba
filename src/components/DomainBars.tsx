import type { DomainAccuracy, DomainInfo } from "@/lib/ui/types";

interface DomainBarsProps {
  title: string;
  subtitle?: string;
  domains: DomainInfo[];
  byDomain: Record<string, DomainAccuracy>;
  /** Questions currently eligible per domain, e.g. from `coverage.byDomain`. */
  availableByDomain?: Record<string, number>;
  passThresholdPercent: number;
  weakestDomains?: string[];
  /** Rendered at the end of each row, e.g. a "Luyện domain này" link. */
  rowAction?: (domainCode: string) => React.ReactNode;
}

/**
 * One horizontal accuracy bar per domain, ordered by exam weight (heaviest
 * first) as the domains already arrive from the catalog. The number of rows
 * is not fixed at six — ECBA renders nine.
 */
export function DomainBars({
  title,
  subtitle,
  domains,
  byDomain,
  availableByDomain,
  passThresholdPercent,
  weakestDomains = [],
  rowAction,
}: DomainBarsProps) {
  const hasAnyData = domains.some((d) => (byDomain[d.code]?.total ?? 0) > 0);

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card px-5 py-5 sm:px-8 sm:py-6">
      <h2 className="text-heading-m text-ink-primary">{title}</h2>
      {subtitle && <p className="mt-1 text-body-small text-ink-secondary">{subtitle}</p>}

      <div className="mt-5 flex flex-col gap-4">
        {domains.map((d) => {
          const acc = byDomain[d.code] ?? { total: 0, correct: 0, percent: 0 };
          const isWeak = weakestDomains.includes(d.code);
          const ok = acc.total > 0 && acc.percent >= passThresholdPercent;
          const barColor = acc.total === 0 ? "bg-border-strong" : ok ? "bg-correct-border" : "bg-wrong-border";
          const available = availableByDomain?.[d.code];

          return (
            /*
              A fixed-width label + a min-content stats block add up to ~430px
              before the bar itself gets a single pixel — comfortably wider
              than a 390px phone. Below `sm` the row stacks: label, then bar,
              then a stats line. `sm:contents` unwraps the stats group back
              into the row's own flex children at `sm` and up, so desktop
              keeps the original single-line layout without a second markup
              structure to maintain.
            */
            <div key={d.code} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="sm:w-[260px] sm:shrink-0 lg:w-[300px]">
                <p className={"text-heading-s " + (isWeak ? "text-wrong-text" : "text-ink-primary")}>
                  {d.code} · {d.weight}% đề
                </p>
                <p className="truncate text-caption text-ink-muted" title={d.nameVi}>
                  {d.nameVi}
                  {available !== undefined && ` · ${available} câu khả dụng`}
                </p>
              </div>

              <div className="relative h-2.5 rounded-full bg-surface-sunken sm:flex-1">
                <div
                  className={"h-2.5 rounded-full transition-all " + barColor}
                  style={{ width: `${Math.min(100, acc.percent)}%` }}
                />
                <div
                  className="absolute -top-1 h-[18px] w-px bg-border-strong"
                  style={{ left: `${passThresholdPercent}%` }}
                  title={`Ngưỡng ${passThresholdPercent}%`}
                />
              </div>

              <div className="flex items-center justify-between gap-3 sm:contents">
                <p className="shrink-0 text-body-small text-ink-secondary sm:w-16 sm:text-right">
                  {acc.correct}/{acc.total}
                </p>
                {/*
                  Colour alone (green/red) is not reliable for colour-blind
                  readers, so pass/fail always repeats as a ✓/✗ glyph next to
                  the percentage — never colour as the only signal.
                */}
                <p
                  className={
                    "flex shrink-0 items-center gap-1 text-body-medium sm:w-20 sm:justify-end sm:text-right " +
                    (acc.total === 0 ? "text-ink-muted" : ok ? "text-correct-text" : "text-wrong-text")
                  }
                >
                  {acc.total > 0 && <span aria-hidden>{ok ? "✓" : "✗"}</span>}
                  {acc.percent}%
                </p>
                {rowAction?.(d.code)}
              </div>
            </div>
          );
        })}
      </div>

      {!hasAnyData && (
        <p className="mt-4 text-body-small text-ink-muted">
          Làm bài đầu tiên để thấy điểm mạnh yếu theo từng phần.
        </p>
      )}
    </section>
  );
}
