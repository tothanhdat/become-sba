import Link from "next/link";

import { startSessionAction } from "@/app/actions";
import { DECKS } from "@/lib/domain";
import type { CertificationSummary, DeckStats } from "@/lib/ui/types";

interface ModeCardsProps {
  certification: CertificationSummary;
  reviewPoolSize: number;
  decks: Record<string, DeckStats>;
}

const TONE = {
  mock: { bg: "bg-mode-mock-bg", border: "border-mode-mock-border", text: "text-mode-mock-text", btn: "bg-mode-mock-text" },
  domain: { bg: "bg-mode-domain-bg", border: "border-mode-domain-border", text: "text-mode-domain-text", btn: "bg-mode-domain-text" },
  quick: { bg: "bg-mode-quick-bg", border: "border-mode-quick-border", text: "text-mode-quick-text", btn: "bg-mode-quick-text" },
  review: { bg: "bg-mode-review-bg", border: "border-mode-review-border", text: "text-mode-review-text", btn: "bg-mode-review-text" },
  // Flashcard doesn't fit the exam-mode palette — it borrows the app's generic
  // accent instead of inventing a sixth mode/* token for one card.
  flashcard: { bg: "bg-accent-soft", border: "border-accent-solid", text: "text-accent-text", btn: "bg-accent-solid" },
} as const;

/**
 * Every way to start studying, in one row: Mock exam, practice by domain,
 * quick quiz, wrong-answer review, and flashcards. All five are equal-height
 * cards whose buttons stay pinned to the bottom regardless of how long each
 * description runs — a CSS grid row stretches its children to match height
 * automatically, so the trick is just `flex-1` on each card's content block
 * pushing the button down.
 *
 * Responsive: 1 column on phones, 2 on tablets, all 5 side by side from
 * `lg` up — that's the width a 5-card row can actually breathe at without
 * each card shrinking past readable.
 */
export function ModeCards({ certification, reviewPoolSize, decks }: ModeCardsProps) {
  const domainLabel = certification.framework.domainLabelVi || certification.framework.domainLabel;
  const disabled = !certification.ready;

  const deckKeys = DECKS.filter((d) => d in decks);
  const totalCards = deckKeys.reduce((acc, d) => acc + decks[d].total, 0);
  const dueCards = deckKeys.reduce((acc, d) => acc + decks[d].due, 0);
  const decksDisabled = totalCards === 0;

  return (
    <section>
      <h2 className="text-heading-m text-ink-primary">Bắt đầu làm bài</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <ModeCard
          tone={TONE.mock}
          title="Mock exam"
          meta={`${certification.questionCount} câu · ${Math.round(certification.timeLimitSec / 60)} phút`}
          description="Đúng tỷ trọng đề thật. Có đồng hồ, có bảng câu hỏi, chỉ xem đáp án sau khi nộp."
          disabled={disabled}
        >
          <input type="hidden" name="certificationCode" value={certification.code} />
          <input type="hidden" name="returnTo" value={`/dashboard?cert=${certification.code}`} />
          <input type="hidden" name="mode" value="mock" />
        </ModeCard>

        <ModeCard
          tone={TONE.domain}
          title={`Luyện theo ${domainLabel}`}
          meta={`Chọn ${domainLabel} · 20 câu`}
          description={`Tập trung một ${domainLabel}. Hiện đáp án và giải thích ngay sau mỗi câu.`}
          disabled={disabled}
        >
          <input type="hidden" name="certificationCode" value={certification.code} />
          <input type="hidden" name="returnTo" value={`/dashboard?cert=${certification.code}`} />
          <input type="hidden" name="mode" value="domain" />
          <select
            name="domain"
            disabled={disabled}
            defaultValue={certification.domains[0]?.code}
            className="mb-2 w-full rounded-md border border-border-strong bg-surface-card px-2 py-1.5 text-body-small text-ink-primary disabled:opacity-50"
          >
            {certification.domains.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.nameVi}
              </option>
            ))}
          </select>
          <input type="hidden" name="total" value={20} />
        </ModeCard>

        <ModeCard
          tone={TONE.quick}
          title="Quick quiz"
          meta="15 câu · ~15 phút"
          description="Trộn ngẫu nhiên theo tỷ trọng đề. Dùng khi có 15 phút rảnh."
          disabled={disabled}
        >
          <input type="hidden" name="certificationCode" value={certification.code} />
          <input type="hidden" name="returnTo" value={`/dashboard?cert=${certification.code}`} />
          <input type="hidden" name="mode" value="quick" />
          <input type="hidden" name="total" value={15} />
        </ModeCard>

        <ModeCard
          tone={TONE.review}
          title="Ôn câu sai"
          badge={reviewPoolSize > 0 ? String(reviewPoolSize) : undefined}
          meta={reviewPoolSize > 0 ? `${reviewPoolSize} câu đang chờ` : "Chưa có câu nào cần ôn"}
          description="Các câu bạn từng làm sai hoặc đã bookmark. Câu nào làm đúng sẽ tự rời khỏi kho."
          disabled={disabled || reviewPoolSize === 0}
        >
          <input type="hidden" name="certificationCode" value={certification.code} />
          <input type="hidden" name="returnTo" value={`/dashboard?cert=${certification.code}`} />
          <input type="hidden" name="mode" value="review" />
          <input type="hidden" name="total" value={Math.min(reviewPoolSize, 50) || 1} />
        </ModeCard>

        <LinkModeCard
          tone={TONE.flashcard}
          href={`/flashcards?cert=${certification.code}`}
          title="Flashcard"
          badge={dueCards > 0 ? String(dueCards) : undefined}
          meta={decksDisabled ? "Chưa có bộ thẻ" : `${dueCards} / ${totalCards} thẻ đến hạn`}
          description="Techniques, Tasks, Glossary — ôn theo SM-2 (Quên / Khó / Tốt / Dễ)."
          disabled={decksDisabled}
          cta="Ôn flashcard"
        />
      </div>

      {!certification.ready && (
        <p className="mt-3 text-body-small text-ink-muted">
          {certification.code} chưa có câu hỏi nào — xem phần blueprint bên dưới.
        </p>
      )}
    </section>
  );
}

interface CardTone {
  bg: string;
  border: string;
  text: string;
  btn: string;
}

function CardBody({
  title,
  badge,
  meta,
  description,
  tone,
  children,
}: {
  title: string;
  badge?: string;
  meta: string;
  description: string;
  tone: CardTone;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <h3 className="text-heading-s text-ink-primary">{title}</h3>
        {badge && (
          <span className="rounded-full bg-wrong-border px-2 py-0.5 text-mono-label text-ink-inverse">{badge}</span>
        )}
      </div>
      <p className={"mt-1 text-caption " + tone.text}>{meta}</p>
      <p className="mt-2 text-body-small text-ink-secondary">{description}</p>
      {children}
    </div>
  );
}

function ModeCard({
  tone,
  title,
  badge,
  meta,
  description,
  disabled,
  children,
}: {
  tone: CardTone;
  title: string;
  badge?: string;
  meta: string;
  description: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      action={startSessionAction}
      className={
        "flex flex-col rounded-xl border px-5 py-[18px] " + tone.bg + " " + tone.border + (disabled ? " opacity-60" : "")
      }
    >
      <CardBody title={title} badge={badge} meta={meta} description={description} tone={tone}>
        {children}
      </CardBody>
      <button
        type="submit"
        disabled={disabled}
        className={
          "mt-4 w-full rounded-lg px-4 py-2.5 text-body-medium text-ink-inverse transition-opacity disabled:cursor-not-allowed disabled:opacity-50 " +
          tone.btn
        }
      >
        Bắt đầu
      </button>
    </form>
  );
}

/** Same shell as ModeCard, but a navigation link rather than a session-starting form. */
function LinkModeCard({
  tone,
  href,
  title,
  badge,
  meta,
  description,
  disabled,
  cta,
}: {
  tone: CardTone;
  href: string;
  title: string;
  badge?: string;
  meta: string;
  description: string;
  disabled?: boolean;
  cta: string;
}) {
  const shell = "flex flex-col rounded-xl border px-5 py-[18px] " + tone.bg + " " + tone.border;

  if (disabled) {
    return (
      <div className={shell + " opacity-60"}>
        <CardBody title={title} badge={badge} meta={meta} description={description} tone={tone} />
        <span className="mt-4 w-full rounded-lg bg-surface-sunken px-4 py-2.5 text-center text-body-medium text-ink-muted">
          {cta}
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className={shell + " transition-shadow hover:shadow-sm"}>
      <CardBody title={title} badge={badge} meta={meta} description={description} tone={tone} />
      <span className={"mt-4 w-full rounded-lg px-4 py-2.5 text-center text-body-medium text-ink-inverse " + tone.btn}>
        {cta}
      </span>
    </Link>
  );
}
