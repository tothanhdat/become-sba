"use client";

import { useCallback, useEffect, useState } from "react";

import type { Deck } from "@/lib/domain";
import type { CardState, DueCard } from "@/lib/ui/types";

interface Props {
  certificationCode: string;
  deck?: Deck;
}

const GRADE_BUTTONS: { key: "forgot" | "hard" | "good" | "easy"; label: string; shortcut: string; tone: string }[] = [
  { key: "forgot", label: "Quên", shortcut: "1", tone: "wrong" },
  { key: "hard", label: "Khó", shortcut: "2", tone: "flagged" },
  { key: "good", label: "Tốt", shortcut: "3", tone: "correct" },
  { key: "easy", label: "Dễ", shortcut: "4", tone: "accent" },
];

const TONE_CLASS: Record<string, { bg: string; text: string; border: string }> = {
  wrong: { bg: "bg-wrong-bg", text: "text-wrong-text", border: "border-wrong-border" },
  flagged: { bg: "bg-flagged-bg", text: "text-flagged-text", border: "border-flagged-border" },
  correct: { bg: "bg-correct-bg", text: "text-correct-text", border: "border-correct-border" },
  accent: { bg: "bg-accent-soft", text: "text-accent-text", border: "border-accent-solid" },
};

/** Preview of the interval each grade would produce, computed from SM-2's own ladder. */
function previewInterval(button: (typeof GRADE_BUTTONS)[number]["key"], card: DueCard): string {
  if (button === "forgot") return "hôm nay";
  if (card.repetitions === 0) return "1 ngày";
  if (card.repetitions === 1) return "6 ngày";
  // Beyond rep 2 the exact multiplier depends on ease factor, which the list
  // endpoint doesn't expose — "khoảng cách mới" still tells the learner it grows.
  return "dài hơn";
}

function BackContent({ back }: { back: string }) {
  const lines = back.split("\n").filter(Boolean);
  const labeled = lines.length > 1 && lines.every((l) => /^[A-Za-z]+:\s/.test(l));

  if (!labeled) {
    return <p className="text-body-default leading-relaxed text-ink-primary">{back}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {lines.map((line) => {
        const [, label, rest] = line.match(/^([A-Za-z]+):\s(.*)$/) ?? [null, "", line];
        // Inputs/Elements/Outputs are "; "-joined lists — a task with five
        // elements used to render as one dense run of text separated by "·".
        // Splitting them into bullets is what actually makes a long list
        // scannable (Purpose stays prose: it's one sentence, not a list).
        const items = rest.split("; ").filter(Boolean);
        const isList = label !== "Purpose" && items.length > 1;

        return (
          <div key={label} className="flex gap-4">
            <p className="w-24 shrink-0 pt-0.5 text-mono-label uppercase text-ink-muted">{label}</p>
            {isList ? (
              <ul className="flex-1 list-disc space-y-1 pl-4 text-body-default text-ink-primary marker:text-ink-muted">
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="flex-1 text-body-default text-ink-primary">{rest}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

type FlipPhase = "idle" | "closing" | "opening";

/**
 * Closing (scaleX 1 → 0) and opening (scaleX 0 → 1) each get their own
 * duration and easing — a flip that accelerates shut and then decelerates
 * back open reads as smooth, weighted motion, not a linear snap.
 *
 * This animates `scaleX`, not a true 3D `rotateY`. A first pass used
 * `rotateY` inside a `perspective` wrapper, which sits in its own compositor
 * layer — combined with the sticky header above it, that occasionally
 * produced a badly skewed frame when captured mid-transition. `scaleX` gets
 * the same "card turning edge-on" read with a plain 2D transform, so there's
 * no 3D layer for the compositor to get wrong.
 */
const FLIP_TRANSITION: Record<Exclude<FlipPhase, "idle">, string> = {
  closing: "transform 200ms cubic-bezier(0.4, 0, 1, 1)", // ease-in: accelerate into the fold
  opening: "transform 260ms cubic-bezier(0.16, 1, 0.3, 1)", // ease-out-expo: decelerate to a soft stop
};

export function FlashcardReviewer({ certificationCode, deck }: Props) {
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  /** "idle" outside an animation; "closing"/"opening" while the card is rotating. */
  const [phase, setPhase] = useState<FlipPhase>("idle");
  const [grading, setGrading] = useState(false);
  const [lastResult, setLastResult] = useState<CardState | null>(null);
  /** A 401 from either the load or the grade endpoint — sign-in is required to continue. */
  const [sessionExpired, setSessionExpired] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ certification: certificationCode, limit: "200" });
    if (deck) params.set("deck", deck);
    const res = await fetch(`/api/flashcards/due?${params}`, { cache: "no-store" });
    if (res.status === 401) {
      // Body is { error: "..." } here, not an array — don't let that land in queue.
      setSessionExpired(true);
      return;
    }
    const cards: DueCard[] = await res.json();
    setQueue(cards);
    setI(0);
    setFlipped(false);
    setPhase("idle");
  }, [certificationCode, deck]);

  /**
   * A click flips the card: squish to scaleX(0) (edge-on, effectively
   * invisible), reveal the back at that midpoint, then unsquish back to
   * scaleX(1). The front stays anchored and the back appends below it rather
   * than replacing it — so a task card's back (four labelled sections)
   * growing the card taller doesn't require a fixed height shared with a
   * one-line glossary back, and the front never jumps position while paging
   * between cards.
   *
   * The swap at the midpoint is driven by the real `transitionend` event
   * rather than a `setTimeout` guessed to match the CSS duration — a timer
   * that fires even a few milliseconds off from the actual animation is
   * exactly the kind of mismatch that reads as a stutter.
   */
  const toggleFlip = useCallback(() => {
    if (phase !== "idle" || grading) return;
    setPhase("closing");
  }, [phase, grading]);

  const onFlipTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.propertyName !== "transform") return;
      if (phase === "closing") {
        setFlipped((f) => !f);
        setPhase("opening");
      } else if (phase === "opening") {
        setPhase("idle");
      }
    },
    [phase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const current = queue?.[i] ?? null;

  const grade = useCallback(
    async (button: (typeof GRADE_BUTTONS)[number]["key"]) => {
      if (!current || grading) return;
      setGrading(true);
      try {
        const res = await fetch(`/api/flashcards/${current.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ button }),
        });
        if (res.status === 401) {
          // Don't advance the queue — the grade wasn't saved, so leave the card in place.
          setSessionExpired(true);
          return;
        }
        if (res.ok) setLastResult(await res.json());
        setI((n) => n + 1);
        setFlipped(false);
      } finally {
        setGrading(false);
      }
    },
    [current, grading],
  );

  // Grading shortcuts only — flipping is a click-the-card gesture now, not a
  // key press (feedback: click-to-flip should replace Space, not sit beside it).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current || !flipped) return;
      const btn = GRADE_BUTTONS.find((b) => b.shortcut === e.key);
      if (btn) void grade(btn.key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, flipped, grade]);

  if (sessionExpired) {
    // Same convention as ExamClient's 401 handling: a sign-in link back to this exact URL.
    const callbackUrl = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/flashcards";
    return (
      <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-14 text-center">
        <p className="text-heading-m text-ink-primary">Phiên đăng nhập hết hạn</p>
        <p className="mt-2 text-body-default text-ink-secondary">Đăng nhập lại để tiếp tục ôn thẻ.</p>
        <a
          href={`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="mt-5 inline-block rounded-lg border border-border-strong px-4 py-2 text-body-small text-ink-primary"
        >
          Đăng nhập lại
        </a>
      </section>
    );
  }

  if (queue === null) {
    return <p className="text-body-default text-ink-muted">Đang tải…</p>;
  }

  const remaining = queue.length - i;

  if (!current) {
    return (
      <section className="rounded-xl border border-border-subtle bg-surface-card px-8 py-14 text-center">
        <p className="text-heading-m text-ink-primary">Hết thẻ đến hạn 🎉</p>
        <p className="mt-2 text-body-default text-ink-secondary">
          Bạn đã ôn hết thẻ đến hạn hôm nay. Quay lại sau khi có thẻ mới đến hạn.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-5 rounded-lg border border-border-strong px-4 py-2 text-body-small text-ink-primary"
        >
          Kiểm tra lại
        </button>
      </section>
    );
  }

  return (
    // Compact and centred rather than spanning the whole reading column — a
    // flashcard is a small, focused object, not a page-width panel. Every
    // child here (progress bar, card, grade buttons) shares this same
    // max-width, so the grade row never runs wider than the card above it.
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="h-1.5 rounded-full bg-surface-sunken">
        <div
          className="h-1.5 rounded-full bg-accent-solid transition-all"
          style={{ width: `${((queue.length - remaining) / queue.length) * 100}%` }}
        />
      </div>
      <p className="text-body-small text-ink-secondary">Còn {remaining} thẻ đến hạn</p>

      {/*
        A native <button> may not contain block-level children per the
        HTML5 content model (phrasing content only) — the card's front and
        back are both block content, so this is a div with button semantics
        instead: role, tabIndex, and an Enter/Space handler give it the same
        keyboard affordance a real button gets for free.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleFlip}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleFlip();
          }
        }}
        onTransitionEnd={onFlipTransitionEnd}
        aria-pressed={flipped}
        title={flipped ? "Nhấn để lật lại" : "Nhấn để lật thẻ"}
        className="cursor-pointer overflow-hidden rounded-xl border border-border-subtle bg-surface-card text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-solid"
        style={{
          transform: phase === "closing" ? "scaleX(0)" : "scaleX(1)",
          transition: phase === "idle" ? FLIP_TRANSITION.opening : FLIP_TRANSITION[phase],
          willChange: "transform",
        }}
      >
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <p className="text-mono-label uppercase text-ink-muted">
            {current.sourceRef ? `${current.sourceRef}${current.domain ? " · " + current.domain : ""}` : current.deck}
          </p>
          <p className="text-heading-l text-ink-primary">{current.front}</p>
        </div>

        {flipped && (
          <div className="border-t border-border-subtle bg-surface-sunken px-6 py-5 text-left">
            <BackContent back={current.back} />
          </div>
        )}

        <p className="border-t border-border-subtle px-6 py-2.5 text-center text-caption text-ink-muted">
          {flipped ? "↺ Nhấn vào thẻ để lật lại" : "↻ Nhấn vào thẻ để lật, xem đáp án"}
        </p>
      </div>

      {flipped && (
        <div className="grid grid-cols-2 gap-3">
          {GRADE_BUTTONS.map((b) => {
            const cls = TONE_CLASS[b.tone];
            return (
              <button
                key={b.key}
                type="button"
                disabled={grading}
                onClick={() => void grade(b.key)}
                className={`flex flex-col items-center gap-0.5 rounded-lg border px-4 py-3 disabled:opacity-60 ${cls.bg} ${cls.border}`}
              >
                <span className={`text-heading-m ${cls.text}`}>{b.label}</span>
                <span className={`text-caption ${cls.text}`}>{previewInterval(b.key, current)}</span>
                <span className="text-caption text-ink-muted">phím {b.shortcut}</span>
              </button>
            );
          })}
        </div>
      )}

      {lastResult && (
        <p className="text-center text-caption text-ink-muted">
          Thẻ trước: lần ôn thứ {lastResult.repetitions}, khoảng cách tiếp theo {lastResult.intervalDays} ngày.
        </p>
      )}
    </div>
  );
}
