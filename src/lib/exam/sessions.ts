import { and, eq, inArray, isNotNull, lte, max, or, isNull, sql } from "drizzle-orm";

import { getCertification, getCertificationById, type Certification } from "@/lib/catalog";
import type { Db } from "@/lib/db";
import {
  bookmarks,
  caseStudies,
  domains,
  examSessions,
  questionOptions,
  questions,
  sessionQuestions,
} from "@/lib/db/schema";
import { OPTION_LABELS, type ExamMode, type OptionLabel } from "@/lib/domain";
import { buildSessionPlan, type PoolQuestion } from "./generator";
import { seededShuffle } from "./rng";
import { scoreSession, type ScoreResult } from "./scoring";

/** How many questions each practice mode serves unless the caller says otherwise. */
const PRACTICE_TOTALS = { domain: 20, quick: 15, review: 20 } as const;

export interface CreateSessionOptions {
  certificationCode: string;
  mode: ExamMode;
  /** Domain code, required for mode "domain". */
  domain?: string;
  total?: number;
  /** Injectable for tests; defaults to a random seed. */
  seed?: number;
  now?: number;
}

/**
 * Whether a question may be served for a certification.
 *
 * This is the rule that keeps the app honest across certifications rather than
 * just reweighting one bank. A CBAP question written at expert level, or bound
 * to a case study, is not a CCBA question: IIBA examines CCBA at Level 2 —
 * Skilled, and its handbook describes the paper as scenario-based with no
 * case studies.
 */
function eligibilityFilter(cert: Certification) {
  return and(
    eq(questions.status, "active"),
    eq(domains.frameworkId, cert.framework.id),
    lte(questions.difficulty, cert.proficiencyLevel),
    cert.allowsCaseStudies ? undefined : isNull(questions.caseStudyId),
  );
}

/**
 * Every question this certification may serve, tagged with when the learner
 * last saw it so the generator can favour unseen material.
 */
function loadPool(db: Db, cert: Certification, restrictTo?: string): PoolQuestion[] {
  const lastSeen = db
    .select({
      questionId: sessionQuestions.questionId,
      lastSeenAt: max(examSessions.startedAt).as("last_seen_at"),
    })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .where(eq(examSessions.certificationId, cert.id))
    .groupBy(sessionQuestions.questionId)
    .as("last_seen");

  const rows = db
    .select({
      id: questions.id,
      domain: domains.code,
      caseStudyId: questions.caseStudyId,
      lastSeenAt: lastSeen.lastSeenAt,
    })
    .from(questions)
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(lastSeen, eq(lastSeen.questionId, questions.id))
    .where(
      restrictTo
        ? and(eligibilityFilter(cert), eq(domains.code, restrictTo))
        : eligibilityFilter(cert),
    )
    .all();

  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    caseStudyId: r.caseStudyId,
    lastSeenAt: r.lastSeenAt ?? null,
  }));
}

/** How many questions this certification can currently serve, per domain. */
export function getBankCoverage(
  db: Db,
  cert: Certification,
): { total: number; byDomain: Record<string, number> } {
  const pool = loadPool(db, cert);
  const byDomain = Object.fromEntries(cert.domains.map((d) => [d.code, 0]));
  for (const q of pool) if (q.domain in byDomain) byDomain[q.domain] += 1;
  return { total: pool.length, byDomain };
}

/**
 * The questions worth revisiting: those whose most recent graded answer was
 * wrong, plus anything bookmarked. A question drops out of the pool as soon as
 * the learner answers it correctly, which is the point of the mode.
 */
export function loadReviewPool(db: Db, cert: Certification): PoolQuestion[] {
  const latestGraded = db
    .select({
      questionId: sessionQuestions.questionId,
      latestAt: max(examSessions.submittedAt).as("latest_at"),
    })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .where(and(isNotNull(examSessions.submittedAt), eq(examSessions.certificationId, cert.id)))
    .groupBy(sessionQuestions.questionId)
    .as("latest_graded");

  const stillWrong = db
    .select({ questionId: sessionQuestions.questionId })
    .from(sessionQuestions)
    .innerJoin(examSessions, eq(examSessions.id, sessionQuestions.sessionId))
    .innerJoin(
      latestGraded,
      and(
        eq(latestGraded.questionId, sessionQuestions.questionId),
        eq(latestGraded.latestAt, examSessions.submittedAt),
      ),
    )
    .where(and(eq(sessionQuestions.isCorrect, false), eq(examSessions.certificationId, cert.id)))
    .all()
    .map((r) => r.questionId);

  const bookmarked = db
    .select({ questionId: bookmarks.questionId })
    .from(bookmarks)
    .all()
    .map((r) => r.questionId);

  const ids = new Set([...stillWrong, ...bookmarked]);
  if (ids.size === 0) return [];

  return loadPool(db, cert).filter((q) => ids.has(q.id));
}

export function createSession(db: Db, options: CreateSessionOptions): number {
  const { certificationCode, mode, domain, now = Date.now() } = options;

  const cert = getCertification(db, certificationCode);
  if (!cert) throw new Error(`Certification ${certificationCode} does not exist`);

  if (mode === "domain" && !domain) {
    throw new Error("A domain is required for a domain-practice session");
  }
  if (domain && !cert.domains.some((d) => d.code === domain)) {
    throw new Error(`Domain ${domain} is not part of ${cert.code}`);
  }

  const total =
    options.total ?? (mode === "mock" ? cert.questionCount : PRACTICE_TOTALS[mode]);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const weights = cert.domains.map((d) => ({ code: d.code, weight: d.weight }));

  const plan =
    mode === "review"
      ? buildSessionPlan({
          domains: weights,
          pool: loadReviewPool(db, cert),
          total,
          seed,
          blueprint: false,
        })
      : buildSessionPlan({
          domains: weights,
          pool: loadPool(db, cert, domain),
          total,
          domain,
          seed,
        });

  if (plan.questionIds.length === 0) {
    throw new Error(
      `${cert.code} has no questions available for this mode yet`,
    );
  }

  const domainId = domain ? cert.domains.find((d) => d.code === domain)!.id : null;

  return db.transaction((tx) => {
    const session = tx
      .insert(examSessions)
      .values({
        certificationId: cert.id,
        mode,
        domainFilterId: domainId,
        questionCount: plan.questionIds.length,
        timeLimitSec: mode === "mock" ? cert.timeLimitSec : null,
        shuffleSeed: seed,
        startedAt: now,
      })
      .returning({ id: examSessions.id })
      .get();

    tx.insert(sessionQuestions)
      .values(
        plan.questionIds.map((questionId, i) => ({
          sessionId: session.id,
          questionId,
          position: i + 1,
        })),
      )
      .run();

    return session.id;
  });
}

export interface TakingOption {
  id: number;
  /** Display label, assigned by position after the per-session shuffle. */
  label: OptionLabel;
  text: string;
}

export interface TakingQuestion {
  position: number;
  questionId: number;
  domain: string;
  domainName: string;
  stem: string;
  caseStudy: { title: string; body: string } | null;
  options: TakingOption[];
  selectedOptionId: number | null;
  flagged: boolean;
}

export interface SessionHeader {
  id: number;
  certificationCode: string;
  certificationName: string;
  accent: Certification["accent"];
  mode: ExamMode;
  domain: string | null;
  questionCount: number;
  timeLimitSec: number | null;
  startedAt: number;
  submittedAt: number | null;
}

export interface TakingView {
  session: SessionHeader;
  questions: TakingQuestion[];
}

function requireSession(db: Db, sessionId: number) {
  const session = db.select().from(examSessions).where(eq(examSessions.id, sessionId)).get();
  if (!session) throw new Error(`Session ${sessionId} does not exist`);
  return session;
}

function headerOf(
  session: typeof examSessions.$inferSelect,
  cert: Certification,
): SessionHeader {
  return {
    id: session.id,
    certificationCode: cert.code,
    certificationName: cert.name,
    accent: cert.accent,
    mode: session.mode,
    domain: session.domainFilterId
      ? (cert.domains.find((d) => d.id === session.domainFilterId)?.code ?? null)
      : null,
    questionCount: session.questionCount,
    timeLimitSec: session.timeLimitSec,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
  };
}

/**
 * The view served while the learner is still working.
 *
 * This deliberately carries no `isCorrect`, no rationale and no explanation:
 * during a mock exam that data must not reach the browser at all, and keeping
 * it out of one shared shape is easier to keep honest than filtering per caller.
 */
export function getSessionForTaking(db: Db, sessionId: number): TakingView {
  const session = requireSession(db, sessionId);
  const cert = getCertificationById(db, session.certificationId)!;

  const rows = db
    .select({
      position: sessionQuestions.position,
      questionId: questions.id,
      domain: domains.code,
      domainName: domains.name,
      stem: questions.stem,
      selectedOptionId: sessionQuestions.selectedOptionId,
      flagged: sessionQuestions.flagged,
      caseTitle: caseStudies.title,
      caseBody: caseStudies.body,
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(caseStudies, eq(caseStudies.id, questions.caseStudyId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .orderBy(sessionQuestions.position)
    .all();

  const optionsByQuestion = loadOptions(db, rows.map((r) => r.questionId));

  return {
    session: headerOf(session, cert),
    questions: rows.map((r) => ({
      position: r.position,
      questionId: r.questionId,
      domain: r.domain,
      domainName: r.domainName,
      stem: r.stem,
      caseStudy: r.caseTitle ? { title: r.caseTitle, body: r.caseBody! } : null,
      options: shuffleForDisplay(
        optionsByQuestion.get(r.questionId) ?? [],
        session.shuffleSeed,
        r.questionId,
      ).map((o, i) => ({ id: o.id, label: OPTION_LABELS[i], text: o.text })),
      selectedOptionId: r.selectedOptionId,
      flagged: r.flagged,
    })),
  };
}

interface StoredOption {
  id: number;
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
  rationale: string;
}

function loadOptions(db: Db, questionIds: number[]): Map<number, StoredOption[]> {
  const byQuestion = new Map<number, StoredOption[]>();
  if (questionIds.length === 0) return byQuestion;

  const rows = db
    .select()
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, questionIds))
    .orderBy(questionOptions.label)
    .all();

  for (const row of rows) {
    const bucket = byQuestion.get(row.questionId);
    const option = {
      id: row.id,
      label: row.label,
      text: row.text,
      isCorrect: row.isCorrect,
      rationale: row.rationale,
    };
    if (bucket) bucket.push(option);
    else byQuestion.set(row.questionId, [option]);
  }
  return byQuestion;
}

/** Per-question shuffle so the correct answer is not always in the same slot. */
function shuffleForDisplay<T>(options: T[], seed: number, questionId: number): T[] {
  return seededShuffle(options, (seed + questionId * 2654435761) >>> 0);
}

export interface AnswerPatch {
  selectedOptionId?: number | null;
  flagged?: boolean;
  timeSpentSec?: number;
}

export function saveAnswer(
  db: Db,
  sessionId: number,
  questionId: number,
  patch: AnswerPatch,
  now: number = Date.now(),
): void {
  const session = requireSession(db, sessionId);
  if (session.submittedAt !== null) {
    throw new Error(`Session ${sessionId} has already been submitted`);
  }

  const row = db
    .select({ id: sessionQuestions.id })
    .from(sessionQuestions)
    .where(
      and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, questionId)),
    )
    .get();
  if (!row) throw new Error(`Question ${questionId} is not part of session ${sessionId}`);

  if (patch.selectedOptionId != null) {
    const owns = db
      .select({ id: questionOptions.id })
      .from(questionOptions)
      .where(
        and(
          eq(questionOptions.id, patch.selectedOptionId),
          eq(questionOptions.questionId, questionId),
        ),
      )
      .get();
    if (!owns) {
      throw new Error(`Option ${patch.selectedOptionId} does not belong to question ${questionId}`);
    }
  }

  db.update(sessionQuestions)
    .set({
      ...(patch.selectedOptionId !== undefined
        ? { selectedOptionId: patch.selectedOptionId, answeredAt: now }
        : {}),
      ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      ...(patch.timeSpentSec !== undefined ? { timeSpentSec: patch.timeSpentSec } : {}),
    })
    .where(eq(sessionQuestions.id, row.id))
    .run();
}

/** Grade the session, freeze it, and return the score. */
export function submitSession(db: Db, sessionId: number, now: number = Date.now()): ScoreResult {
  const session = requireSession(db, sessionId);
  if (session.submittedAt !== null) {
    throw new Error(`Session ${sessionId} was already submitted`);
  }
  const cert = getCertificationById(db, session.certificationId)!;

  const rows = db
    .select({
      sessionQuestionId: sessionQuestions.id,
      questionId: sessionQuestions.questionId,
      selectedOptionId: sessionQuestions.selectedOptionId,
      domain: domains.code,
      correctOptionId: sql<number>`(
        select id from question_options
        where question_id = ${sessionQuestions.questionId} and is_correct = 1
      )`.as("correct_option_id"),
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .all();

  const score = scoreSession(
    rows,
    cert.domains.map((d) => d.code),
    cert.passThresholdPercent,
  );

  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(sessionQuestions)
        .set({
          isCorrect:
            row.selectedOptionId !== null && row.selectedOptionId === row.correctOptionId,
        })
        .where(eq(sessionQuestions.id, row.sessionQuestionId))
        .run();
    }
    tx.update(examSessions)
      .set({ submittedAt: now, score: score.correct })
      .where(eq(examSessions.id, sessionId))
      .run();
  });

  return score;
}

export interface ResultOption extends TakingOption {
  isCorrect: boolean;
  rationale: string;
}

export interface ResultQuestion {
  position: number;
  questionId: number;
  domain: string;
  domainName: string;
  sourceRef: string;
  sourceTask: string;
  stem: string;
  caseStudy: { title: string; body: string } | null;
  explanation: string;
  options: ResultOption[];
  selectedOptionId: number | null;
  isCorrect: boolean;
  flagged: boolean;
  note: string | null;
  bookmarked: boolean;
}

export interface ResultView {
  session: SessionHeader;
  certification: Certification;
  score: ScoreResult;
  questions: ResultQuestion[];
}

/** The full post-mortem, available only once the session is graded. */
export function getSessionResult(db: Db, sessionId: number): ResultView {
  const session = requireSession(db, sessionId);
  if (session.submittedAt === null) {
    throw new Error(`Session ${sessionId} has not been submitted yet`);
  }
  const cert = getCertificationById(db, session.certificationId)!;

  const rows = db
    .select({
      position: sessionQuestions.position,
      questionId: questions.id,
      domain: domains.code,
      domainName: domains.name,
      sourceRef: questions.sourceRef,
      sourceTask: questions.sourceTask,
      stem: questions.stem,
      explanation: questions.explanation,
      selectedOptionId: sessionQuestions.selectedOptionId,
      isCorrect: sessionQuestions.isCorrect,
      flagged: sessionQuestions.flagged,
      caseTitle: caseStudies.title,
      caseBody: caseStudies.body,
      note: sql<string | null>`(select body from user_notes where question_id = ${questions.id})`.as("note"),
      bookmarked: sql<number>`(select count(*) from bookmarks where question_id = ${questions.id})`.as("bookmarked"),
    })
    .from(sessionQuestions)
    .innerJoin(questions, eq(questions.id, sessionQuestions.questionId))
    .innerJoin(domains, eq(domains.id, questions.domainId))
    .leftJoin(caseStudies, eq(caseStudies.id, questions.caseStudyId))
    .where(eq(sessionQuestions.sessionId, sessionId))
    .orderBy(sessionQuestions.position)
    .all();

  const optionsByQuestion = loadOptions(db, rows.map((r) => r.questionId));

  const score = scoreSession(
    rows.map((r) => ({
      domain: r.domain,
      selectedOptionId: r.selectedOptionId,
      correctOptionId:
        (optionsByQuestion.get(r.questionId) ?? []).find((o) => o.isCorrect)?.id ?? -1,
    })),
    cert.domains.map((d) => d.code),
    cert.passThresholdPercent,
  );

  return {
    session: headerOf(session, cert),
    certification: cert,
    score,
    questions: rows.map((r) => ({
      position: r.position,
      questionId: r.questionId,
      domain: r.domain,
      domainName: r.domainName,
      sourceRef: r.sourceRef,
      sourceTask: r.sourceTask,
      stem: r.stem,
      caseStudy: r.caseTitle ? { title: r.caseTitle, body: r.caseBody! } : null,
      explanation: r.explanation,
      options: shuffleForDisplay(
        optionsByQuestion.get(r.questionId) ?? [],
        session.shuffleSeed,
        r.questionId,
      ).map((o, i) => ({
        id: o.id,
        label: OPTION_LABELS[i],
        text: o.text,
        isCorrect: o.isCorrect,
        rationale: o.rationale,
      })),
      selectedOptionId: r.selectedOptionId,
      isCorrect: r.isCorrect ?? false,
      flagged: r.flagged,
      note: r.note,
      bookmarked: r.bookmarked > 0,
    })),
  };
}
