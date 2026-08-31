import type { TakingQuestion } from "@/lib/ui/types";

interface Props {
  questions: TakingQuestion[];
  currentPosition: number;
  onJump: (position: number) => void;
  /** Desktop-only: lets a long case study borrow the palette's width. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * 4 states, matched 1:1 with the legend so the grid never needs a second look.
 * Flagged gets a heavier border on top of its own colour — at 24px the amber
 * fill alone read as too faint against the flagged/unanswered pairing.
 */
function cellClass(q: TakingQuestion, isCurrent: boolean): string {
  if (isCurrent) return "border-accent-solid bg-accent-solid text-ink-inverse";
  if (q.flagged) return "border-2 border-flagged-border bg-flagged-bg font-semibold text-flagged-text";
  if (q.selectedOptionId !== null) return "border-border-strong bg-surface-sunken text-ink-primary";
  return "border-border-subtle bg-surface-card text-ink-muted";
}

export function QuestionPalette({ questions, currentPosition, onJump, collapsed, onToggleCollapse }: Props) {
  const answered = questions.filter((q) => q.selectedOptionId !== null).length;
  const flagged = questions.filter((q) => q.flagged).length;
  const unanswered = questions.length - answered;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-surface-card p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Mở bảng câu hỏi"
          className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken"
        >
          ⟨⟨
        </button>
        <p className="text-mono-label text-ink-muted [writing-mode:vertical-rl]">
          {currentPosition}/{questions.length}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-mono-label uppercase text-ink-muted">Bảng câu hỏi</p>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Thu gọn bảng câu hỏi"
            className="rounded-md px-1.5 py-0.5 text-ink-secondary hover:bg-surface-sunken"
          >
            ⟩⟩
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-8 gap-1.5 lg:grid-cols-6">
        {questions.map((q) => (
          <button
            key={q.questionId}
            type="button"
            onClick={() => onJump(q.position)}
            title={`Câu ${q.position}`}
            className={
              "flex h-6 w-6 items-center justify-center rounded border text-caption transition-colors " +
              cellClass(q, q.position === currentPosition)
            }
          >
            {q.position}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-1.5 border-t border-border-subtle pt-3 text-body-small">
        <LegendRow swatchClass="bg-surface-sunken border-border-strong" label="Đã trả lời" value={answered} />
        <LegendRow swatchClass="border-2 border-flagged-border bg-flagged-bg" label="Đã đánh dấu" value={flagged} />
        <LegendRow swatchClass="bg-surface-card border-border-subtle" label="Chưa làm" value={unanswered} />
      </div>
    </div>
  );
}

function LegendRow({ swatchClass, label, value }: { swatchClass: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={"h-3.5 w-3.5 rounded border " + swatchClass} />
      <span className="text-ink-secondary">{label}</span>
      <span className="ml-auto text-body-medium text-ink-primary">{value}</span>
    </div>
  );
}
