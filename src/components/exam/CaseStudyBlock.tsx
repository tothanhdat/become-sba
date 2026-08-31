"use client";

interface Props {
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
}

/** Stays open or closed as the learner pages through questions sharing this case. */
export function CaseStudyBlock({ title, body, open, onToggle }: Props) {
  return (
    <div className="rounded-lg border-l-[3px] border-border-strong bg-surface-sunken px-5 py-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-body-small text-ink-muted">{open ? "▾" : "▸"}</span>
        <span className="text-mono-label uppercase text-ink-muted">Case study</span>
        <span className="text-heading-s text-ink-primary">{title}</span>
      </button>
      {open && <p className="mt-3 text-body-small leading-relaxed text-ink-secondary">{body}</p>}
    </div>
  );
}
