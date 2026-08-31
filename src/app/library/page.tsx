import { AppShell } from "@/components/AppShell";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const all = listCertifications(db).map((cert) => {
    const coverage = getBankCoverage(db, cert);
    const summary: CertificationSummary = {
      code: cert.code,
      name: cert.name,
      nameVi: cert.nameVi,
      body: cert.body,
      tier: cert.tier,
      accent: cert.accent,
      framework: cert.framework,
      questionCount: cert.questionCount,
      timeLimitSec: cert.timeLimitSec,
      passThresholdPercent: cert.passThresholdPercent,
      passThresholdSource: cert.passThresholdSource,
      proficiencyLabel: cert.proficiencyLabel,
      questionTypes: cert.questionTypes,
      eligibility: cert.eligibility,
      domains: cert.domains,
      availableQuestions: coverage.total,
      availableByDomain: coverage.byDomain,
      ready: coverage.total > 0,
    };
    return summary;
  });

  const requested = (await searchParams).cert;
  const current = all.find((c) => c.code === requested) ?? all[all.length - 1];

  return (
    <AppShell certifications={all} current={current} active="library">
      <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-10 text-center">
        <h2 className="text-heading-l text-ink-primary">Thư viện câu hỏi</h2>
        <p className="mx-auto mt-3 max-w-prose text-body-default text-ink-secondary">
          Màn duyệt lại toàn bộ câu hỏi theo domain, bookmark, hoặc ghi chú cần một endpoint lọc
          (<code className="rounded bg-surface-sunken px-1.5 py-0.5 text-body-small">GET /api/questions</code>)
          chưa xây. Trong lúc chờ, dùng "Ôn câu sai" trên{" "}
          <a href={`/dashboard?cert=${current.code}`} className="text-accent-text underline">
            Trang chủ
          </a>{" "}
          để ôn lại câu đã sai hoặc đã bookmark.
        </p>
      </section>
    </AppShell>
  );
}
