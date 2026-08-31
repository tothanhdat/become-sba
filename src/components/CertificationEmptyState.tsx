import { ACCENT_SOLID_BG } from "@/lib/ui/accent";
import type { CertificationSummary } from "@/lib/ui/types";

interface Props {
  certification: CertificationSummary;
  /** Does any certification that already has content share this framework? */
  frameworkHasContentElsewhere: boolean;
}

/**
 * Screen 7 of the UI spec: a certification with zero eligible questions still
 * gets picked, still shows its real exam facts, and gets told the specific
 * reason instead of a generic "no data yet".
 */
export function CertificationEmptyState({ certification, frameworkHasContentElsewhere }: Props) {
  const usesCaseStudies = certification.questionTypes.toLowerCase().includes("case-study");

  const reason = frameworkHasContentElsewhere
    ? `${certification.code} thi trên cùng ${certification.framework.name} với chứng chỉ khác đã có nội dung, nhưng ở ${certification.proficiencyLabel}` +
      (usesCaseStudies ? "" : " và không dùng case-study") +
      `. Câu hỏi hiện có được viết cho cấp độ khác nên không đủ điều kiện phục vụ ${certification.code}.`
    : `${certification.code} thi trên ${certification.framework.name}, khác với framework của các chứng chỉ đã có nội dung. Kho câu hỏi hiện có không dùng lại được cho ${certification.code} — đây là khác biệt về nội dung thi, không phải giới hạn kỹ thuật.`;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-7">
        <h2 className="text-heading-l text-ink-primary">Chưa có câu hỏi cho {certification.code}</h2>
        <p className="mt-3 max-w-prose text-body-default text-ink-secondary">{reason}</p>
        <p className="mt-2 max-w-prose text-body-small text-ink-muted">
          Blueprint bên dưới đã cấu hình đầy đủ theo handbook chính thức của IIBA. Khi có câu hỏi được
          viết đúng cho {certification.code}, chứng chỉ này hoạt động ngay mà không cần sửa code.
        </p>
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-6">
        <h2 className="text-heading-m text-ink-primary">
          Blueprint {certification.code} — {certification.domains.length} {certification.framework.domainLabelVi}
        </h2>
        <p className="mt-1 text-body-small text-ink-secondary">
          Nguồn: handbook chính thức của IIBA cho {certification.code}.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          {certification.domains.map((d) => (
            <div key={d.code} className="flex items-center gap-4">
              <div className="w-[240px] shrink-0 sm:w-[320px]">
                <p className="text-heading-s text-ink-primary">
                  {d.code} · {d.weight}% đề
                </p>
                <p className="truncate text-caption text-ink-muted" title={d.nameVi}>
                  {d.nameVi}
                </p>
              </div>
              <div className="h-2.5 flex-1 rounded-full bg-surface-sunken">
                <div
                  className={"h-2.5 rounded-full " + ACCENT_SOLID_BG[certification.accent]}
                  style={{ width: `${(d.weight / Math.max(...certification.domains.map((x) => x.weight))) * 100}%` }}
                />
              </div>
              <p className="w-16 shrink-0 text-right text-body-small text-ink-muted">0 câu</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
