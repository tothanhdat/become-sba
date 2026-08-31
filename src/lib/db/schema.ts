import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  Accent,
  Deck,
  Difficulty,
  ExamMode,
  OptionLabel,
  QuestionStatus,
} from "@/lib/domain";

/**
 * Single-learner app: there is no users table and no auth. If this ever becomes
 * multi-user, every table below gains a `userId` column and nothing else changes.
 *
 * Timestamps are unix milliseconds so they sort and diff without parsing.
 */

const now = sql`(unixepoch() * 1000)`;

/**
 * A body of knowledge that certifications are examined against, e.g. BABOK v3.
 * Questions belong to a framework, not to a certification, so two
 * certifications examining the same framework share one question bank.
 */
export const frameworks = sqliteTable("frameworks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  /** What this framework calls its divisions, e.g. "Knowledge Area". */
  domainLabel: text("domain_label").notNull(),
  domainLabelVi: text("domain_label_vi").notNull(),
});

/**
 * A division of a framework: a BABOK knowledge area, an ECBA performance
 * domain. Replaces what used to be a hardcoded six-value union type.
 */
export const domains = sqliteTable(
  "domains",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameworkId: integer("framework_id")
      .notNull()
      .references(() => frameworks.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameVi: text("name_vi").notNull(),
    /** Where the domain sits in the source material, e.g. BABOK chapter "7". */
    reference: text("reference"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("domains_framework_code_idx").on(t.frameworkId, t.code)],
);

export const certifications = sqliteTable("certifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  nameVi: text("name_vi").notNull(),
  /** Awarding body, e.g. IIBA. */
  body: text("body").notNull(),
  tier: text("tier").notNull(),
  frameworkId: integer("framework_id")
    .notNull()
    .references(() => frameworks.id),
  questionCount: integer("question_count").notNull(),
  timeLimitSec: integer("time_limit_sec").notNull(),
  passThresholdPercent: integer("pass_threshold_percent").notNull(),
  /** Where the threshold came from — none of the IIBA exams publish a cut score. */
  passThresholdSource: text("pass_threshold_source").notNull(),
  /** Questions harder than this are never served for this certification. */
  proficiencyLevel: integer("proficiency_level").$type<Difficulty>().notNull(),
  proficiencyLabel: text("proficiency_label").notNull(),
  /** CBAP uses case studies; CCBA and ECBA do not. */
  allowsCaseStudies: integer("allows_case_studies", { mode: "boolean" }).notNull(),
  questionTypes: text("question_types").notNull(),
  eligibility: text("eligibility").notNull(),
  accent: text("accent").$type<Accent>().notNull(),
  sortOrder: integer("sort_order").notNull(),
});

/** Each certification's own weighting of its framework's domains. */
export const certificationDomains = sqliteTable(
  "certification_domains",
  {
    certificationId: integer("certification_id")
      .notNull()
      .references(() => certifications.id, { onDelete: "cascade" }),
    domainId: integer("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    /** Percentage of the exam. Weights for one certification sum to 100. */
    weight: integer("weight").notNull(),
  },
  (t) => [uniqueIndex("cert_domains_idx").on(t.certificationId, t.domainId)],
);

/**
 * A shared narrative that several questions hang off. CBAP leans on these:
 * one multi-paragraph business situation, then a run of questions about it.
 */
export const caseStudies = sqliteTable("case_studies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stable human-readable key, e.g. "CS-RADD-01". Import matches on this. */
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const questions = sqliteTable(
  "questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable key from the content pack, e.g. "RADD-042". Makes seeding idempotent. */
    code: text("code").notNull().unique(),
    /** The framework domain this question belongs to; it implies the framework. */
    domainId: integer("domain_id")
      .notNull()
      .references(() => domains.id),
    /** Section number within the source material, e.g. BABOK "7.1". Verified at import. */
    sourceRef: text("source_ref").notNull(),
    /** Named unit within the source, e.g. the BABOK task "Specify and Model Requirements". */
    sourceTask: text("source_task").notNull(),
    /**
     * 1 = foundational, 2 = skilled application, 3 = expert judgement. A
     * certification only serves questions at or below its proficiency level.
     */
    difficulty: integer("difficulty").$type<Difficulty>().notNull().default(2),
    caseStudyId: integer("case_study_id").references(() => caseStudies.id),
    /** Question stem. Kept in English: the real exam is English-only. */
    stem: text("stem").notNull(),
    /** Overall teaching explanation, shown after grading. */
    explanation: text("explanation").notNull(),
    /**
     * "active" questions are eligible for exams. "draft" means the BABOK
     * reference could not be verified against the PDF, so it stays out of exams.
     */
    status: text("status").$type<QuestionStatus>().notNull().default("draft"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("questions_domain_status_idx").on(t.domainId, t.status)],
);

export const questionOptions = sqliteTable(
  "question_options",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    label: text("label").$type<OptionLabel>().notNull(),
    text: text("text").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
    /**
     * Why this specific option is right, or why it is wrong. CBAP always offers
     * two near-miss distractors, so per-option reasoning is the whole point.
     */
    rationale: text("rationale").notNull(),
  },
  (t) => [uniqueIndex("question_options_q_label_idx").on(t.questionId, t.label)],
);

/** One free-text note per question, written by the learner. */
export const userNotes = sqliteTable("user_notes", {
  questionId: integer("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const bookmarks = sqliteTable("bookmarks", {
  questionId: integer("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(now),
});

export const examSessions = sqliteTable("exam_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  certificationId: integer("certification_id")
    .notNull()
    .references(() => certifications.id),
  mode: text("mode").$type<ExamMode>().notNull(),
  /** Set only for mode "domain". */
  domainFilterId: integer("domain_filter_id").references(() => domains.id),
  questionCount: integer("question_count").notNull(),
  /** null = untimed (practice modes). */
  timeLimitSec: integer("time_limit_sec"),
  /** Seed for option shuffling, so a session renders identically on reload. */
  shuffleSeed: integer("shuffle_seed").notNull(),
  startedAt: integer("started_at").notNull().default(now),
  submittedAt: integer("submitted_at"),
  /** Number of correct answers. Written only at submit time. */
  score: integer("score"),
});

export const sessionQuestions = sqliteTable(
  "session_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    /** 1-based position in this session. */
    position: integer("position").notNull(),
    selectedOptionId: integer("selected_option_id").references(() => questionOptions.id),
    /** Written at submit time, not while answering. */
    isCorrect: integer("is_correct", { mode: "boolean" }),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    timeSpentSec: integer("time_spent_sec").notNull().default(0),
    answeredAt: integer("answered_at"),
  },
  (t) => [
    uniqueIndex("session_questions_pos_idx").on(t.sessionId, t.position),
    uniqueIndex("session_questions_q_idx").on(t.sessionId, t.questionId),
  ],
);

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    /** Decks belong to a framework, so every certification on it shares them. */
    frameworkId: integer("framework_id")
      .notNull()
      .references(() => frameworks.id, { onDelete: "cascade" }),
    deck: text("deck").$type<Deck>().notNull(),
    front: text("front").notNull(),
    back: text("back").notNull(),
    domainId: integer("domain_id").references(() => domains.id),
    sourceRef: text("source_ref"),
  },
  (t) => [index("flashcards_deck_idx").on(t.frameworkId, t.deck)],
);

/** Current SM-2 state of a card. One row per card, created on first review. */
export const flashcardStates = sqliteTable(
  "flashcard_states",
  {
    cardId: integer("card_id")
      .primaryKey()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    /** SM-2 ease factor, floored at 1.3. */
    easeFactor: real("ease_factor").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueAt: integer("due_at").notNull(),
    lastReviewedAt: integer("last_reviewed_at"),
  },
  (t) => [index("flashcard_states_due_idx").on(t.dueAt)],
);

/** Append-only log, so progress charts can be rebuilt later. */
export const flashcardReviews = sqliteTable("flashcard_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id")
    .notNull()
    .references(() => flashcards.id, { onDelete: "cascade" }),
  grade: integer("grade").notNull(),
  intervalDaysAfter: integer("interval_days_after").notNull(),
  reviewedAt: integer("reviewed_at").notNull().default(now),
});
