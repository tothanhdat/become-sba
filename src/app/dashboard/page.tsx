import { AppShell } from "@/components/AppShell";
import { CertificationEmptyState } from "@/components/CertificationEmptyState";
import { DomainBars } from "@/components/DomainBars";
import { HistoryTable } from "@/components/HistoryTable";
import { ModeCards } from "@/components/ModeCards";
import { ReadinessCard } from "@/components/ReadinessCard";
import { auth } from "@/lib/auth";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

/** Shapes a catalog Certification into the same JSON contract the API returns. */
function toSummary(
  cert: ReturnType<typeof listCertifications>[number],
  availableQuestions: number,
  availableByDomain: Record<string, number>,
): CertificationSummary {
  return {
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
    availableQuestions,
    availableByDomain,
    ready: availableQuestions > 0,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const all = listCertifications(db).map((cert) => {
    const coverage = getBankCoverage(db, cert);
    return { cert, summary: toSummary(cert, coverage.total, coverage.byDomain) };
  });

  const requested = (await searchParams).cert;
  const found = all.find((c) => c.summary.code === requested);
  // Default to the certification with the most content, so a first-time visit
  // lands somewhere useful rather than on an empty ECBA screen.
  const current = found ?? [...all].sort((a, b) => b.summary.availableQuestions - a.summary.availableQuestions)[0];

  const certifications = all.map((c) => c.summary);

  if (!current.summary.ready) {
    const frameworkHasContentElsewhere = all.some(
      (c) => c.summary.framework.code === current.summary.framework.code && c.summary.ready,
    );
    return (
      <AppShell certifications={certifications} current={current.summary} active="dashboard" user={session?.user ?? null}>
        <CertificationEmptyState
          certification={current.summary}
          frameworkHasContentElsewhere={frameworkHasContentElsewhere}
        />
      </AppShell>
    );
  }

  const { cert } = current;
  const readiness = getReadiness(db, userId, cert);
  const history = getSessionHistory(db, userId, cert, 15);
  const decks = getDeckStats(db, userId, cert.framework.id);
  const coverage = getBankCoverage(db, cert);
  const reviewPoolSize = loadReviewPool(db, userId, cert).length;

  const weakestDomainLabels = readiness.weakestDomains.map(
    (code) => cert.domains.find((d) => d.code === code)?.code ?? code,
  );

  return (
    <AppShell certifications={certifications} current={current.summary} active="dashboard" user={session?.user ?? null}>
      <div className="flex flex-col gap-6">
        <ReadinessCard
          readiness={readiness}
          passThresholdPercent={cert.passThresholdPercent}
          passThresholdSource={cert.passThresholdSource}
          weakestDomainLabels={weakestDomainLabels}
        />

        <DomainBars
          title={`Độ chính xác theo ${cert.framework.domainLabelVi}`}
          subtitle={`Xếp theo tỷ trọng đề thi thật. Vạch đứt là ngưỡng ${cert.passThresholdPercent}%.`}
          domains={cert.domains}
          byDomain={readiness.byDomain}
          availableByDomain={coverage.byDomain}
          passThresholdPercent={cert.passThresholdPercent}
          weakestDomains={readiness.weakestDomains}
        />

        <ModeCards certification={current.summary} reviewPoolSize={reviewPoolSize} decks={decks} />

        <HistoryTable history={history} passThresholdPercent={cert.passThresholdPercent} />
      </div>
    </AppShell>
  );
}
