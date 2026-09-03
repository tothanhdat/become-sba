import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { startSessionAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { DomainBars } from "@/components/DomainBars";
import { ReviewList } from "@/components/result/ReviewList";
import { auth } from "@/lib/auth";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, getSessionResult } from "@/lib/exam/sessions";
import { formatMinutes } from "@/lib/ui/format";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const sessionId = Number((await params).id);
  if (!Number.isInteger(sessionId)) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/result/${sessionId}`)}`);
  }

  let result;
  try {
    result = getSessionResult(db, session.user.id, sessionId);
  } catch {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-xl border border-wrong-border bg-wrong-bg px-6 py-5 text-center">
          <p className="text-body-default text-wrong-text">
            Bài này chưa được nộp, hoặc không tồn tại.
          </p>
          <Link href="/dashboard" className="mt-3 inline-block text-body-small text-accent-text underline">
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

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

  const current = all.find((c) => c.code === result.certification.code)!;
  const wrongCount = result.questions.filter((q) => !q.isCorrect).length;

  return (
    <AppShell certifications={all} current={current} active="dashboard" user={session.user}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-wrap items-center gap-10 rounded-xl border border-border-subtle bg-surface-card px-8 py-7">
          <div>
            <p className="text-mono-label uppercase text-ink-muted">Điểm</p>
            <p className="text-display-score text-ink-primary">
              {result.score.correct} / {result.score.total}
            </p>
            <p className={"text-heading-l " + (result.score.passed ? "text-correct-text" : "text-wrong-text")}>
              {result.score.percent}%
            </p>
          </div>

          <div className="flex-1">
            <span
              className={
                "inline-flex items-center rounded-md px-3 py-1.5 text-body-medium " +
                (result.score.passed ? "bg-correct-bg text-correct-text" : "bg-wrong-bg text-wrong-text")
              }
            >
              {result.score.passed ? "✓ ĐẠT" : "✗ CHƯA ĐẠT"}
            </span>
            <p className="mt-2 max-w-prose text-body-small text-ink-secondary">
              Ngưỡng {result.certification.passThresholdPercent}% ({result.certification.passThresholdSource}) ·
              bỏ trống {result.score.unanswered} câu
              {result.session.submittedAt !== null && (
                <> · làm trong {formatMinutes((result.session.submittedAt - result.session.startedAt) / 1000)}</>
              )}
            </p>
          </div>

          {wrongCount > 0 && (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="returnTo" value={`/result/${sessionId}`} />
              <input type="hidden" name="mode" value="review" />
              <input type="hidden" name="total" value={Math.min(wrongCount, 50)} />
              <button
                type="submit"
                className="rounded-lg bg-accent-solid px-5 py-2.5 text-body-medium text-ink-inverse"
              >
                Ôn lại {wrongCount} câu vừa sai
              </button>
            </form>
          )}
        </section>

        <DomainBars
          title={`Phân tích theo ${result.certification.framework.domainLabelVi}`}
          domains={result.certification.domains}
          byDomain={result.score.byDomain}
          passThresholdPercent={result.certification.passThresholdPercent}
          rowAction={(code) => (
            <form action={startSessionAction}>
              <input type="hidden" name="certificationCode" value={result.certification.code} />
              <input type="hidden" name="returnTo" value={`/result/${sessionId}`} />
              <input type="hidden" name="mode" value="domain" />
              <input type="hidden" name="domain" value={code} />
              <input type="hidden" name="total" value={20} />
              <button
                type="submit"
                className="whitespace-nowrap rounded-md bg-surface-sunken px-3 py-1.5 text-caption text-ink-secondary hover:bg-border-subtle"
              >
                Luyện {code} →
              </button>
            </form>
          )}
        />

        <ReviewList questions={result.questions} frameworkName={result.certification.framework.name} />
      </div>
    </AppShell>
  );
}
