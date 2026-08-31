export interface AnsweredQuestion {
  /** Domain code within the certification's framework. */
  domain: string;
  /** null when the learner ran out of time or skipped the question. */
  selectedOptionId: number | null;
  correctOptionId: number;
}

export interface DomainScore {
  total: number;
  correct: number;
  percent: number;
}

export interface ScoreResult {
  total: number;
  correct: number;
  unanswered: number;
  /** Rounded to one decimal for display. Do not compare against it. */
  percent: number;
  passed: boolean;
  byDomain: Record<string, DomainScore>;
}

function percentOf(correct: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((correct / total) * 1000) / 10;
}

/**
 * Grade a finished session against its certification's domains and threshold.
 *
 * `domainCodes` is passed in rather than derived from the answers so the
 * breakdown always covers every domain of the certification, including any the
 * learner happened not to be asked about.
 *
 * `passed` compares the raw ratio, not `percent`: a 69.95% score rounds to
 * "70.0" on screen but is still a fail, and showing a pass there would be a lie.
 */
export function scoreSession(
  answers: AnsweredQuestion[],
  domainCodes: readonly string[],
  passThresholdPercent: number,
): ScoreResult {
  const byDomain = Object.fromEntries(
    domainCodes.map((code) => [code, { total: 0, correct: 0, percent: 0 }]),
  ) as Record<string, DomainScore>;

  let correct = 0;
  let unanswered = 0;

  for (const a of answers) {
    const isCorrect = a.selectedOptionId !== null && a.selectedOptionId === a.correctOptionId;
    if (a.selectedOptionId === null) unanswered += 1;
    if (isCorrect) correct += 1;

    // A question from outside the listed domains still counts toward the total.
    const bucket = byDomain[a.domain];
    if (bucket) {
      bucket.total += 1;
      if (isCorrect) bucket.correct += 1;
    }
  }

  for (const code of domainCodes) {
    byDomain[code].percent = percentOf(byDomain[code].correct, byDomain[code].total);
  }

  const total = answers.length;

  return {
    total,
    correct,
    unanswered,
    percent: percentOf(correct, total),
    passed: total > 0 && (correct / total) * 100 >= passThresholdPercent,
    byDomain,
  };
}
