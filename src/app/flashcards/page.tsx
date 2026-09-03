import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { FlashcardReviewer } from "@/components/flashcards/FlashcardReviewer";
import { auth } from "@/lib/auth";
import { DECKS, type Deck } from "@/lib/domain";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";
import type { CertificationSummary } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

const DECK_META: Record<Deck, { title: string; blurb: string }> = {
  techniques: { title: "Techniques", blurb: "50 kỹ thuật BABOK — mục đích & khi nào dùng" },
  tasks: { title: "Tasks", blurb: "30 task — Purpose / Inputs / Elements / Outputs" },
  glossary: { title: "Glossary", blurb: "206 thuật ngữ & định nghĩa BABOK" },
};

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string; deck?: string }>;
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

  const params = await searchParams;
  const current =
    all.find((c) => c.code === params.cert) ?? [...all].sort((a, b) => b.availableQuestions - a.availableQuestions)[0];
  const requestedDeck = DECKS.includes(params.deck as Deck) ? (params.deck as Deck) : undefined;
  const reviewing = params.deck === "all" || requestedDeck !== undefined;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  if (reviewing && !session) {
    const callback = `/flashcards?cert=${current.code}${params.deck ? `&deck=${params.deck}` : ""}`;
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
  }

  const decks = getDeckStats(db, userId, current.framework.id);
  const totalCards = DECKS.reduce((acc, d) => acc + decks[d].total, 0);

  return (
    <AppShell certifications={all} current={current} active="flashcards" user={session?.user ?? null}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          {DECKS.map((d) => {
            const active = requestedDeck === d;
            return (
              <Link
                key={d}
                href={`/flashcards?cert=${current.code}&deck=${d}`}
                className={
                  "rounded-full px-3.5 py-1.5 text-body-small transition-colors " +
                  (active
                    ? "bg-surface-inverse text-ink-inverse"
                    : "border border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
                }
              >
                {DECK_META[d].title} ({decks[d].due}/{decks[d].total})
              </Link>
            );
          })}
          <Link
            href={`/flashcards?cert=${current.code}&deck=all`}
            className={
              "rounded-full px-3.5 py-1.5 text-body-small transition-colors " +
              (params.deck === "all"
                ? "bg-surface-inverse text-ink-inverse"
                : "border border-border-strong bg-surface-card text-ink-secondary hover:bg-surface-sunken")
            }
          >
            Tất cả
          </Link>
        </div>

        {totalCards === 0 ? (
          <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-10 text-center">
            <p className="text-heading-m text-ink-primary">Chưa có bộ thẻ nào cho {current.framework.name}</p>
            <p className="mt-2 text-body-small text-ink-secondary">
              Flashcard thuộc framework, không thuộc riêng {current.code}.
            </p>
          </section>
        ) : reviewing ? (
          <FlashcardReviewer certificationCode={current.code} deck={requestedDeck} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {DECKS.map((d) => {
              const s = decks[d];
              const meta = DECK_META[d];
              return (
                <Link
                  key={d}
                  href={`/flashcards?cert=${current.code}&deck=${d}`}
                  className="rounded-xl border border-border-subtle bg-surface-card px-6 py-5 transition-colors hover:border-border-strong"
                >
                  <h3 className="text-heading-m text-ink-primary">{meta.title}</h3>
                  <p className="mt-1 text-body-small text-ink-secondary">{meta.blurb}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-body-small">
                    {session ? (
                      <>
                        <Stat label="Đến hạn" value={s.due} tone="accent" />
                        <Stat label="Chưa học" value={s.new} tone="muted" />
                        <Stat label="Đang học" value={s.learning} tone="muted" />
                        <Stat label="Tổng" value={s.total} tone="muted" />
                      </>
                    ) : (
                      <>
                        <Stat label="Tổng" value={s.total} tone="muted" />
                        <p className="text-caption text-ink-muted">Đăng nhập để xem lịch ôn của bạn</p>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "accent" | "muted" }) {
  return (
    <div>
      <p className={"text-heading-s " + (tone === "accent" ? "text-accent-text" : "text-ink-primary")}>{value}</p>
      <p className="text-caption text-ink-muted">{label}</p>
    </div>
  );
}
