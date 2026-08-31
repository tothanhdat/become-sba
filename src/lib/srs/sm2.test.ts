import { describe, expect, test } from "vitest";

import { REVIEW_GRADES } from "@/lib/domain";
import { DAY_MS, initialCardState, scheduleReview, type CardState } from "./sm2";

const NOW = Date.UTC(2026, 0, 1);

/** Replays a run of grades against a fresh card and returns the final state. */
function replay(buttons: (keyof typeof REVIEW_GRADES)[], now = NOW): CardState {
  let state = initialCardState(now);
  buttons.forEach((button, i) => {
    state = scheduleReview(state, REVIEW_GRADES[button], now + i * DAY_MS);
  });
  return state;
}

describe("scheduleReview", () => {
  test("first successful review schedules the card one day out", () => {
    const state = replay(["good"]);
    expect(state.repetitions).toBe(1);
    expect(state.intervalDays).toBe(1);
  });

  test("second successful review schedules six days out", () => {
    expect(replay(["good", "good"]).intervalDays).toBe(6);
  });

  test("third review multiplies the interval by the ease factor", () => {
    // "good" leaves the ease factor at its 2.5 default, so 6 * 2.5 = 15.
    const state = replay(["good", "good", "good"]);
    expect(state.easeFactor).toBeCloseTo(2.5, 5);
    expect(state.intervalDays).toBe(15);
  });

  test("grading a card easy raises its ease factor", () => {
    const state = replay(["easy"]);
    expect(state.easeFactor).toBeCloseTo(2.6, 5);
  });

  test("grading a card hard lowers its ease factor but still advances it", () => {
    const state = replay(["hard"]);
    expect(state.easeFactor).toBeCloseTo(2.36, 5);
    expect(state.repetitions).toBe(1);
    expect(state.intervalDays).toBe(1);
  });

  test("forgetting a card resets it to be relearned immediately", () => {
    const state = replay(["good", "good", "forgot"]);
    expect(state.repetitions).toBe(0);
    expect(state.intervalDays).toBe(0);
    expect(state.lapses).toBe(1);
  });

  test("a forgotten card comes due right away", () => {
    const reviewedAt = NOW + 2 * DAY_MS;
    const state = scheduleReview(initialCardState(NOW), REVIEW_GRADES.forgot, reviewedAt);
    expect(state.dueAt).toBe(reviewedAt);
  });

  test("a card relearned after a lapse restarts at one day", () => {
    expect(replay(["good", "good", "forgot", "good"]).intervalDays).toBe(1);
  });

  test("the ease factor never falls below the SM-2 floor of 1.3", () => {
    const state = replay(Array<keyof typeof REVIEW_GRADES>(20).fill("forgot"));
    expect(state.easeFactor).toBeCloseTo(1.3, 5);
  });

  test("due date is the review time plus the new interval", () => {
    const reviewedAt = NOW + 5 * DAY_MS;
    const state = scheduleReview(initialCardState(NOW), REVIEW_GRADES.good, reviewedAt);
    expect(state.dueAt).toBe(reviewedAt + 1 * DAY_MS);
  });

  test("intervals stay whole days", () => {
    let state = initialCardState(NOW);
    for (let i = 0; i < 8; i++) {
      state = scheduleReview(state, REVIEW_GRADES.easy, NOW + i * DAY_MS);
      expect(Number.isInteger(state.intervalDays)).toBe(true);
    }
  });

  test("rejects a grade outside the SM-2 scale", () => {
    expect(() => scheduleReview(initialCardState(NOW), 9 as never, NOW)).toThrow();
  });
});

describe("initialCardState", () => {
  test("a new card is due immediately and unseen", () => {
    const state = initialCardState(NOW);
    expect(state).toEqual({
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      dueAt: NOW,
      lastReviewedAt: null,
    });
  });
});
