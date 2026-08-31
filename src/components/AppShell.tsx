import Link from "next/link";

import { ACCENT_SOFT_BG, ACCENT_SOLID_BG, ACCENT_TEXT } from "@/lib/ui/accent";
import type { CertificationSummary } from "@/lib/ui/types";

interface AppShellProps {
  certifications: CertificationSummary[];
  current: CertificationSummary;
  active: "dashboard" | "flashcards" | "library";
  children: React.ReactNode;
}

// Flashcard has no top-nav entry — it's reached from its own mode card on the
// Dashboard now, so a second entry point in the header was redundant.
const NAV = [
  { key: "dashboard", label: "Trang chủ", href: "/dashboard" },
  { key: "library", label: "Thư viện câu hỏi", href: "/library" },
] as const;

/**
 * The shell every non-exam screen sits inside: logo, certification switcher,
 * primary nav, and a context strip stating the active certification's real
 * exam facts. Present on Dashboard, Result, Flashcards, Library — the exam-
 * taking screen opts out entirely (see docs/UI-SPEC.md "distraction free").
 */
export function AppShell({ certifications, current, active, children }: AppShellProps) {
  return (
    <div className="min-h-screen">
      {/*
        Logo + cert switcher + nav together are well past 700px of minimum
        content width (3 two-line cert tabs, 3 nav labels) — nowhere near a
        phone. `flex-wrap` plus `w-full sm:w-auto` on the switcher and nav
        groups stacks the header into three short rows below `sm` and
        recombines them into one row once there's room.
      */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border-subtle bg-surface-card/95 px-6 py-3 backdrop-blur sm:px-12">
        {/*
          The logo lockup bakes its wordmark into the artwork (icon + "Become
          a S-BA" stacked), so it needs real height for that text to read —
          taller than a typical inline text logo would need. `h-20` is the
          floor that keeps the wordmark legible without the header eating
          most of the viewport.
        */}
        <Link href={`/dashboard?cert=${current.code}`} className="shrink-0">
          <img src="/logo.png" alt="Become a S-BA" className="h-20 w-auto" />
        </Link>

        <nav
          aria-label="Chọn chứng chỉ"
          className="flex w-full items-center gap-1 overflow-x-auto rounded-[10px] bg-surface-sunken p-1 sm:w-auto"
        >
          {certifications.map((cert) => {
            const isActive = cert.code === current.code;
            return (
              <Link
                key={cert.code}
                href={`/dashboard?cert=${cert.code}`}
                className={
                  "flex shrink-0 flex-col items-center rounded-lg px-3.5 py-1.5 text-center transition-colors " +
                  (isActive ? ACCENT_SOLID_BG[cert.accent] : "hover:bg-surface-card")
                }
              >
                <span className={"text-heading-s " + (isActive ? "text-ink-inverse" : "text-ink-secondary")}>
                  {cert.code}
                </span>
                <span className={"text-caption " + (isActive ? "text-ink-inverse/85" : "text-ink-muted")}>
                  {cert.ready ? `${cert.availableQuestions} câu` : "chưa có dữ liệu"}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex w-full flex-wrap items-center gap-4 sm:ml-auto sm:w-auto sm:gap-6">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.key === "dashboard" ? `${item.href}?cert=${current.code}` : item.href}
              className={
                "text-body-small transition-colors " +
                (active === item.key ? "font-medium text-ink-primary" : "text-ink-secondary hover:text-ink-primary")
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </header>

      <div
        className={
          "flex flex-wrap items-center gap-4 px-6 py-3 sm:gap-7 sm:px-12 " + ACCENT_SOFT_BG[current.accent]
        }
      >
        <div>
          <p className={"text-heading-s " + ACCENT_TEXT[current.accent]}>
            {current.code} — {current.name}
          </p>
          <p className="text-caption text-ink-secondary">
            {current.body} · {current.tier} · {current.framework.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:ml-auto sm:gap-7">
          <Stat label="ĐỀ THI" value={`${current.questionCount} câu / ${Math.round(current.timeLimitSec / 60)} phút`} />
          <Stat label="DẠNG CÂU" value={current.questionTypes} />
          <Stat label="CẤP ĐỘ" value={current.proficiencyLabel} />
          <Stat label="NGƯỠNG ĐẠT" value={`~${current.passThresholdPercent}% (ước tính)`} />
        </div>
      </div>

      <main className="px-6 py-8 sm:px-12 sm:py-10">{children}</main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-mono-label uppercase text-ink-muted">{label}</p>
      <p className="text-body-small text-ink-primary">{value}</p>
    </div>
  );
}
