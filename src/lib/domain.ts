/**
 * Vocabulary shared across every certification.
 *
 * Anything that varies between certifications — the domains, their weights, the
 * question count, the time limit, the pass threshold — is DATA, held in
 * content/catalog/ and loaded into the database. It deliberately does not live
 * here. The three IIBA certifications alone disagree on all of it, and ECBA does
 * not even use BABOK's knowledge areas.
 */

export const EXAM_MODES = ["mock", "domain", "quick", "review"] as const;
export type ExamMode = (typeof EXAM_MODES)[number];

export const OPTION_LABELS = ["A", "B", "C", "D"] as const;
export type OptionLabel = (typeof OPTION_LABELS)[number];

export const QUESTION_STATUSES = ["active", "draft", "retired"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/**
 * How demanding a question is, matched against a certification's proficiency
 * level. A certification only serves questions at or below its own level, which
 * is why CBAP's level-3 questions never appear in a CCBA exam.
 */
export const DIFFICULTIES = [1, 2, 3] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DECKS = ["techniques", "tasks", "glossary"] as const;
export type Deck = (typeof DECKS)[number];

/** Accent colours a certification can be branded with in the UI. */
export const ACCENTS = ["indigo", "teal", "amber", "plum", "slate"] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * The four buttons a learner presses when reviewing a flashcard, mapped to the
 * SM-2 quality scale. Anything below 3 counts as a lapse.
 */
export const REVIEW_GRADES = {
  forgot: 2,
  hard: 3,
  good: 4,
  easy: 5,
} as const;

export type ReviewButton = keyof typeof REVIEW_GRADES;
export type ReviewGrade = (typeof REVIEW_GRADES)[ReviewButton];
