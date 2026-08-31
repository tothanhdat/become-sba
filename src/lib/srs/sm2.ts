import type { ReviewGrade } from "@/lib/domain";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** SM-2 refuses to let a card get harder than this. */
const MIN_EASE_FACTOR = 1.3;
const DEFAULT_EASE_FACTOR = 2.5;

/** Below this quality the learner did not recall the card at all. */
const PASSING_GRADE = 3;

export interface CardState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  /** Unix ms. The card is ready to study once now >= dueAt. */
  dueAt: number;
  lastReviewedAt: number | null;
}

export function initialCardState(now: number): CardState {
  return {
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: now,
    lastReviewedAt: null,
  };
}

/**
 * Advance a card through one SM-2 review.
 *
 * One deliberate deviation from the 1987 paper: a lapsed card gets an interval
 * of 0 and comes due immediately rather than tomorrow, so the learner can
 * relearn it in the same sitting. Everything else — the ease-factor formula,
 * the 1/6/interval*EF ladder, the 1.3 floor — is stock SM-2.
 */
export function scheduleReview(
  state: CardState,
  grade: ReviewGrade,
  reviewedAt: number,
): CardState {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new Error(`Review grade must be 0-5 on the SM-2 scale, got ${grade}`);
  }

  const q = grade;
  const easeFactor = Math.max(
    MIN_EASE_FACTOR,
    state.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  if (q < PASSING_GRADE) {
    return {
      easeFactor,
      intervalDays: 0,
      repetitions: 0,
      lapses: state.lapses + 1,
      dueAt: reviewedAt,
      lastReviewedAt: reviewedAt,
    };
  }

  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(state.intervalDays * easeFactor);

  return {
    easeFactor,
    intervalDays,
    repetitions,
    lapses: state.lapses,
    dueAt: reviewedAt + intervalDays * DAY_MS,
    lastReviewedAt: reviewedAt,
  };
}
