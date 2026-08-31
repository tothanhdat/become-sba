import { allocateByBlueprint, type DomainWeight } from "./blueprint";
import { seededShuffle } from "./rng";

export type { DomainWeight } from "./blueprint";

export interface PoolQuestion {
  id: number;
  /** Domain code within the certification's framework. */
  domain: string;
  /** Questions sharing a case study are always presented together. */
  caseStudyId: number | null;
  /** Unix ms of the last time this question was served; null if never served. */
  lastSeenAt: number | null;
}

export interface BuildSessionOptions {
  /** The certification's domains and weights, in framework order. */
  domains: readonly DomainWeight[];
  pool: PoolQuestion[];
  total: number;
  /** Restrict the whole session to one domain (the "practice by domain" mode). */
  domain?: string;
  /**
   * Apply the IIBA weighting (default). Turn it off for wrong-answer review,
   * where the pool is already the exact set of questions the learner missed and
   * reweighting it would drop some of them.
   */
  blueprint?: boolean;
  /** Stored on the session so it can be rebuilt identically. */
  seed: number;
}

export interface SessionPlan {
  /** Question ids in presentation order. */
  questionIds: number[];
  /**
   * Per domain, how many blueprint slots the pool could not fill. Non-empty
   * means the exam no longer matches the real weighting and the UI should say
   * so instead of pretending it was a faithful mock.
   */
  shortfallByDomain: Record<string, number>;
}

/** A case study and its questions, or a single standalone question. */
interface Group {
  domain: string;
  items: PoolQuestion[];
  /** Oldest last-seen time in the group; -Infinity when any item is unseen. */
  freshness: number;
}

function groupQuestions(questions: PoolQuestion[]): Group[] {
  const byCase = new Map<number, PoolQuestion[]>();
  const groups: Group[] = [];

  for (const q of questions) {
    if (q.caseStudyId === null) {
      groups.push({ domain: q.domain, items: [q], freshness: q.lastSeenAt ?? -Infinity });
      continue;
    }
    const bucket = byCase.get(q.caseStudyId);
    if (bucket) bucket.push(q);
    else byCase.set(q.caseStudyId, [q]);
  }

  for (const items of byCase.values()) {
    groups.push({
      domain: items[0].domain,
      items,
      freshness: Math.min(...items.map((q) => q.lastSeenAt ?? -Infinity)),
    });
  }

  return groups;
}

/**
 * Order groups so the learner meets unseen material first, then whatever they
 * have gone longest without seeing. The shuffle runs before the sort — since
 * Array.prototype.sort is stable, that randomises ties without disturbing the
 * freshness ordering.
 */
function prioritise(groups: Group[], seed: number): Group[] {
  return seededShuffle(groups, seed).sort((a, b) => a.freshness - b.freshness);
}

/** Greedily take whole groups that still fit in `capacity`. */
function takeGroups(groups: Group[], capacity: number): { taken: Group[]; used: number } {
  const taken: Group[] = [];
  let used = 0;
  for (const group of groups) {
    if (used === capacity) break;
    if (group.items.length > capacity - used) continue;
    taken.push(group);
    used += group.items.length;
  }
  return { taken, used };
}

/**
 * Pick the questions for one session.
 *
 * Pure: it never touches the database. Feed it the candidate pool and it
 * returns ids, so the same logic covers mock exams, per-area practice, quick
 * quizzes, and wrong-answer review.
 */
export function buildSessionPlan(options: BuildSessionOptions): SessionPlan {
  const { domains, pool, total, domain: restrictTo, seed, blueprint = true } = options;

  const eligible = restrictTo ? pool.filter((q) => q.domain === restrictTo) : pool;
  const quota: Record<string, number> = !blueprint
    ? {}
    : restrictTo
      ? { [restrictTo]: total }
      : allocateByBlueprint(total, domains);

  const groupsByDomain = new Map<string, Group[]>();
  for (const group of groupQuestions(eligible)) {
    const bucket = groupsByDomain.get(group.domain);
    if (bucket) bucket.push(group);
    else groupsByDomain.set(group.domain, [group]);
  }

  const selected: Group[] = [];
  const shortfallByDomain: Record<string, number> = {};
  const used = new Set<Group>();

  Object.keys(quota).forEach((code, i) => {
    const want = quota[code];
    if (want === 0) return;

    const candidates = prioritise(groupsByDomain.get(code) ?? [], seed + i * 7919);
    const { taken, used: got } = takeGroups(candidates, want);

    for (const group of taken) {
      selected.push(group);
      used.add(group);
    }
    if (got < want) shortfallByDomain[code] = want - got;
  });

  // Top up from any eligible area so a mock exam is still full length. The
  // shortfall above records that the blueprint was not honoured.
  const deficit = total - selected.reduce((acc, g) => acc + g.items.length, 0);
  if (deficit > 0) {
    const leftovers = prioritise(
      [...groupsByDomain.values()].flat().filter((g) => !used.has(g)),
      seed + 104729,
    );
    selected.push(...takeGroups(leftovers, deficit).taken);
  }

  return {
    questionIds: seededShuffle(selected, seed).flatMap((g) => g.items.map((q) => q.id)),
    shortfallByDomain,
  };
}
