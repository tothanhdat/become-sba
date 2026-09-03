import type { Accent, Deck, ExamMode, OptionLabel } from "@/lib/domain";

/**
 * Shapes of the JSON the API routes actually return, as consumed by client
 * components. Kept separate from the server-side lib/*.ts interfaces because
 * those carry internal ids and DB-shaped fields the wire format doesn't need.
 */

export interface DomainInfo {
  id: number;
  code: string;
  name: string;
  nameVi: string;
  reference: string | null;
  sortOrder: number;
  weight: number;
}

export interface FrameworkInfo {
  id: number;
  code: string;
  name: string;
  source: string;
  domainLabel: string;
  domainLabelVi: string;
}

export interface CertificationSummary {
  code: string;
  name: string;
  nameVi: string;
  body: string;
  tier: string;
  accent: Accent;
  framework: FrameworkInfo;
  questionCount: number;
  timeLimitSec: number;
  passThresholdPercent: number;
  passThresholdSource: string;
  proficiencyLabel: string;
  questionTypes: string;
  eligibility: string;
  domains: DomainInfo[];
  availableQuestions: number;
  availableByDomain: Record<string, number>;
  ready: boolean;
}

export interface DomainAccuracy {
  total: number;
  correct: number;
  percent: number;
}

export interface Readiness {
  answered: number;
  correct: number;
  overallPercent: number;
  onTrack: boolean;
  byDomain: Record<string, DomainAccuracy>;
  weakestDomains: string[];
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
  durationSec: number;
}

export interface DeckStats {
  total: number;
  new: number;
  due: number;
  learning: number;
}

export interface StatsResponse {
  certification: Pick<
    CertificationSummary,
    | "code"
    | "name"
    | "nameVi"
    | "accent"
    | "framework"
    | "questionCount"
    | "timeLimitSec"
    | "passThresholdPercent"
    | "passThresholdSource"
    | "proficiencyLabel"
    | "domains"
  >;
  readiness: Readiness;
  history: HistoryEntry[];
  decks: Record<Deck, DeckStats>;
  coverage: { total: number; byDomain: Record<string, number> };
  reviewPoolSize: number;
}

export interface TakingOption {
  id: number;
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

export interface QuestionTranslation {
  stem: string;
  options: { label: OptionLabel; text: string }[];
  caseStudy: { title: string; body: string } | null;
}

export interface SessionHeader {
  id: number;
  certificationCode: string;
  certificationName: string;
  accent: Accent;
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

export interface ScoreResult {
  total: number;
  correct: number;
  unanswered: number;
  percent: number;
  passed: boolean;
  byDomain: Record<string, DomainAccuracy>;
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

export interface ResultCertification {
  code: string;
  name: string;
  nameVi: string;
  accent: Accent;
  framework: FrameworkInfo;
  questionCount: number;
  timeLimitSec: number;
  passThresholdPercent: number;
  passThresholdSource: string;
  proficiencyLabel: string;
  domains: DomainInfo[];
}

export interface ResultView {
  session: SessionHeader;
  certification: ResultCertification;
  score: ScoreResult;
  questions: ResultQuestion[];
}

export interface DueCard {
  id: number;
  deck: Deck;
  front: string;
  back: string;
  domain: string | null;
  sourceRef: string | null;
  dueAt: number | null;
  repetitions: number;
}

export interface CardState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: number;
  lastReviewedAt: number | null;
}
