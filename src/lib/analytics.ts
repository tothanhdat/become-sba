import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { Certification } from "./catalog";
import type { Db } from "./db";
import { domains, examSessions, questions, sessionQuestions } from "./db/schema";
import type { ExamMode } from "./domain";

export interface DomainAccuracy {
  total: number;
  correct: number;
  percent: number;
}

export interface Readiness {
  answered: number;
  correct: number;
  overallPercent: number;
  /** True once lifetime accuracy clears this certification's threshold. */
  onTrack: boolean;
  byDomain: Record<string, DomainAccuracy>;
  /** Domains below the threshold, weakest first. Empty when all are healthy. */
  weakestDomains: string[];
}

function percentOf(correct: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((correct / total) * 1000) / 10;
}

function emptyReadiness(cert: Certification): Readiness {
  const byDomain = Object.fromEntries(
    cert.domains.map((d) => [d.code, { total: 0, correct: 0, percent: 0 }]),
  ) as Record<string, DomainAccuracy>;
  return { answered: 0, correct: 0, overallPercent: 0, onTrack: false, byDomain, weakestDomains: [] };
}

/**
 * Lifetime accuracy for one certification, sliced by its own domains.
 *
 * Scoped per certification because progress does not transfer: a strong CBAP
 * record says nothing about ECBA, which examines a different framework
 * entirely.
 *
 * Only submitted sessions count: an exam still in progress has no answers worth
 * measuring, and half-finished attempts would drag the numbers down unfairly.
 *
 * A logged-out visitor has no history — this returns the same zeroed shape a
 * brand-new signed-in user would see, without touching the database.
 */
export function getReadiness(db: Db, userId: string | null, cert: Certification): Readiness {
  if (userId === null) return emptyReadiness(cert);

  const rows = db
    .select({ domain: domains.code, isCorrect: sessionQuestions.isCorrect })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(
      and(
        isNotNull(examSessions.submittedAt),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .all();

  const byDomain = Object.fromEntries(
    cert.domains.map((d) => [d.code, { total: 0, correct: 0, percent: 0 }]),
  ) as Record<string, DomainAccuracy>;

  let correct = 0;
  for (const row of rows) {
    const bucket = byDomain[row.domain];
    if (!bucket) continue;
    bucket.total += 1;
    if (row.isCorrect) {
      bucket.correct += 1;
      correct += 1;
    }
  }

  for (const d of cert.domains) {
    byDomain[d.code].percent = percentOf(byDomain[d.code].correct, byDomain[d.code].total);
  }

  const weakestDomains = cert.domains
    .map((d) => d.code)
    .filter((code) => byDomain[code].total > 0 && byDomain[code].percent < cert.passThresholdPercent)
    .sort((a, b) => byDomain[a].percent - byDomain[b].percent);

  const answered = rows.length;

  return {
    answered,
    correct,
    overallPercent: percentOf(correct, answered),
    onTrack: answered > 0 && (correct / answered) * 100 >= cert.passThresholdPercent,
    byDomain,
    weakestDomains,
  };
}

export interface HistoryEntry {
  id: number;
  mode: ExamMode;
  domain: string | null;
  questionCount: number;
  score: number;
  percent: number;
  passed: boolean;
  startedAt: number;
  submittedAt: number;
  /** Wall-clock seconds spent, useful for pacing against the real time limit. */
  durationSec: number;
}

export function getSessionHistory(
  db: Db,
  userId: string | null,
  cert: Certification,
  limit = 50,
): HistoryEntry[] {
  if (userId === null) return [];

  const rows = db
    .select({
      session: examSessions,
      domainCode: domains.code,
    })
    .from(examSessions)
    .leftJoin(domains, eq(domains.id, examSessions.domainFilterId))
    .where(
      and(
        isNotNull(examSessions.submittedAt),
        eq(examSessions.certificationId, cert.id),
        eq(examSessions.userId, userId),
      ),
    )
    .orderBy(desc(examSessions.submittedAt), desc(examSessions.id))
    .limit(limit)
    .all();

  return rows.map(({ session: s, domainCode }) => ({
    id: s.id,
    mode: s.mode,
    domain: domainCode,
    questionCount: s.questionCount,
    score: s.score ?? 0,
    percent: percentOf(s.score ?? 0, s.questionCount),
    passed:
      s.questionCount > 0 &&
      ((s.score ?? 0) / s.questionCount) * 100 >= cert.passThresholdPercent,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt!,
    durationSec: Math.max(0, Math.round((s.submittedAt! - s.startedAt) / 1000)),
  }));
}
