export interface DomainWeight {
  /** Domain code within the certification's framework, e.g. "RADD" or "UBA". */
  code: string;
  /** Share of the exam. Weights are normalised, so they need not sum to 100. */
  weight: number;
}

export type Allocation = Record<string, number>;

/**
 * Split `total` questions across a certification's domains in the proportions
 * its exam body publishes.
 *
 * The weights arrive as data rather than as constants, because the three IIBA
 * certifications disagree on both the weights and the domains themselves: CBAP
 * and CCBA weight the same six BABOK knowledge areas differently, while ECBA
 * uses nine performance domains that do not exist in BABOK at all.
 *
 * Uses the largest-remainder method rather than rounding each share
 * independently: rounding leaves the counts summing to something other than
 * `total` (CBAP's 120 rounds to 118), which would silently produce a short
 * exam. Ties are broken by the order of `domains`, so the result is
 * reproducible.
 */
export function allocateByBlueprint(total: number, domains: readonly DomainWeight[]): Allocation {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`Question total must be a non-negative integer, got ${total}`);
  }
  if (domains.length === 0) return {};

  const weightTotal = domains.reduce((acc, d) => acc + d.weight, 0);
  if (weightTotal <= 0) {
    throw new Error("Blueprint must have at least one domain with a positive weight");
  }

  // Remainders are compared as exact integers rather than as floats. With
  // floating point, CCBA's three domains that all land on .6 sorted in an
  // arbitrary order, so the tie-break silently stopped following domain order
  // and the same blueprint could produce different exams.
  const shares = domains.map((d, order) => {
    const numerator = total * d.weight;
    const base = Math.floor(numerator / weightTotal);
    return { code: d.code, order, base, remainder: numerator - base * weightTotal };
  });

  const allocation = Object.fromEntries(shares.map((s) => [s.code, s.base])) as Allocation;

  let leftover = total - shares.reduce((acc, s) => acc + s.base, 0);
  const byRemainder = [...shares].sort(
    (a, b) => b.remainder - a.remainder || a.order - b.order,
  );

  for (const share of byRemainder) {
    if (leftover === 0) break;
    allocation[share.code] += 1;
    leftover -= 1;
  }

  return allocation;
}
