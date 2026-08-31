import Link from "next/link";

import { formatMinutes } from "@/lib/ui/format";
import type { HistoryEntry } from "@/lib/ui/types";

import { ScoreTrend } from "./ScoreTrend";

export function HistoryTable({
  history,
  passThresholdPercent,
}: {
  history: HistoryEntry[];
  passThresholdPercent: number;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-6">
      <h2 className="text-heading-m text-ink-primary">Lịch sử làm bài</h2>

      {history.length === 0 ? (
        <p className="mt-3 text-body-small text-ink-muted">Chưa có bài nào được nộp.</p>
      ) : (
        <>
          <div className="mt-4">
            <ScoreTrend history={history} passThresholdPercent={passThresholdPercent} />
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-border-subtle text-left text-mono-label uppercase text-ink-muted">
                <th className="pb-2.5 font-medium">Chế độ</th>
                <th className="pb-2.5 font-medium">Số câu</th>
                <th className="pb-2.5 font-medium">Điểm</th>
                <th className="pb-2.5 font-medium">%</th>
                <th className="pb-2.5 font-medium">Kết quả</th>
                <th className="pb-2.5 font-medium">Thời gian</th>
                <th className="pb-2.5" />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-border-subtle last:border-0">
                  <td className="py-3 text-body-small text-ink-primary">
                    {MODE_LABEL[h.mode] ?? h.mode}
                    {h.domain ? ` (${h.domain})` : ""}
                  </td>
                  <td className="py-3 text-body-small text-ink-primary">{h.questionCount}</td>
                  <td className="py-3 text-body-small text-ink-primary">{h.score}</td>
                  <td className="py-3 text-body-small text-ink-primary">{h.percent}%</td>
                  <td className={"py-3 text-body-medium " + (h.passed ? "text-correct-text" : "text-wrong-text")}>
                    {h.passed ? "Đạt" : "Chưa đạt"}
                  </td>
                  <td className="py-3 text-body-small text-ink-primary">{formatMinutes(h.durationSec)}</td>
                  <td className="py-3 text-right">
                    <Link href={`/result/${h.id}`} className="text-body-small text-accent-text hover:underline">
                      Xem lại →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}

const MODE_LABEL: Record<string, string> = {
  mock: "Mock exam",
  domain: "Luyện theo domain",
  quick: "Quick quiz",
  review: "Ôn câu sai",
};
