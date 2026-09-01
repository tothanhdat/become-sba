/**
 * Test-only fixtures. Not imported by production code.
 */
import { BABOK_TASKS } from "@/lib/babok";
import { importCatalog, type CertificationPack, type FrameworkPack } from "@/lib/catalog";
import { importQuestionPack } from "@/lib/content/importer";
import type { QuestionPack } from "@/lib/content/schema";
import type { Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { OPTION_LABELS, type Difficulty } from "@/lib/domain";

export const TEST_USER_ID = "test-user-1";

/** Inserts a minimal user row so userId-scoped foreign keys resolve in tests. */
export function createTestUser(db: Db, id: string = TEST_USER_ID): string {
  db.insert(users).values({ id, email: `${id}@example.test` }).run();
  return id;
}

const BABOK_DOMAINS = ["BAPM", "EC", "RLCM", "SA", "RADD", "SE"] as const;

/** The first BABOK task of each domain, so citations pass the import gate. */
const SAMPLE_REF: Record<string, string> = {
  BAPM: "3.1", EC: "4.1", RLCM: "5.1", SA: "6.1", RADD: "7.1", SE: "8.1",
};

export const testFrameworks: FrameworkPack = {
  version: 1,
  frameworks: [
    {
      code: "babok-v3",
      name: "BABOK Guide v3",
      source: "IIBA",
      domainLabel: "Knowledge Area",
      domainLabelVi: "Knowledge Area",
      domains: BABOK_DOMAINS.map((code, i) => ({
        code,
        name: `Domain ${code}`,
        nameVi: `Domain ${code}`,
        reference: String(i + 3),
        order: i + 1,
      })),
    },
    {
      code: "ba-standard",
      name: "The Business Analysis Standard",
      source: "IIBA",
      domainLabel: "Performance Domain",
      domainLabelVi: "Performance Domain",
      domains: [
        { code: "UBA", name: "Understanding Business Analysis", nameVi: "Hiểu về BA", order: 1 },
        { code: "CTX", name: "Context", nameVi: "Bối cảnh", order: 2 },
      ],
    },
  ],
};

/** CBAP, CCBA and ECBA with their real blueprints, as the catalog seeds them. */
export const testCertifications: CertificationPack = {
  version: 1,
  certifications: [
    {
      code: "CBAP", name: "Certified Business Analysis Professional", nameVi: "CBAP",
      body: "IIBA", tier: "Senior", frameworkCode: "babok-v3",
      questionCount: 120, timeLimitSec: 12600,
      passThresholdPercent: 70, passThresholdSource: "Community estimate",
      proficiencyLevel: 3, proficiencyLabel: "Level 3 — Expert",
      allowsCaseStudies: true, questionTypes: "case-study and scenario-based",
      eligibility: "7,500 hours", accent: "indigo", order: 2,
      domainWeights: { BAPM: 14, EC: 12, RLCM: 15, SA: 15, RADD: 30, SE: 14 },
    },
    {
      code: "CCBA", name: "Certification of Capability in Business Analysis", nameVi: "CCBA",
      body: "IIBA", tier: "Core", frameworkCode: "babok-v3",
      questionCount: 130, timeLimitSec: 10800,
      passThresholdPercent: 70, passThresholdSource: "Community estimate",
      proficiencyLevel: 2, proficiencyLabel: "Level 2 — Skilled",
      allowsCaseStudies: false, questionTypes: "scenario-based",
      eligibility: "3,750 hours", accent: "teal", order: 1,
      domainWeights: { BAPM: 12, EC: 20, RLCM: 18, SA: 12, RADD: 32, SE: 6 },
    },
    {
      code: "ECBA", name: "Entry Certificate in Business Analysis", nameVi: "ECBA",
      body: "IIBA", tier: "Foundational", frameworkCode: "ba-standard",
      questionCount: 50, timeLimitSec: 4500,
      passThresholdPercent: 70, passThresholdSource: "IIBA reports pass/fail",
      proficiencyLevel: 1, proficiencyLabel: "Level 1 — Foundational",
      allowsCaseStudies: false, questionTypes: "situation-based",
      eligibility: "None", accent: "amber", order: 0,
      domainWeights: { UBA: 60, CTX: 40 },
    },
  ],
};

export interface BankOptions {
  /** Difficulty of every question. Default 2, which every certification can serve. */
  difficulty?: Difficulty;
}

/** A pack with `perDomain` active questions in every BABOK domain. Option A is always correct. */
export function sampleBank(perDomain: number, options: BankOptions = {}): QuestionPack {
  const difficulty = options.difficulty ?? 2;
  return {
    version: 1,
    frameworkCode: "babok-v3",
    questions: BABOK_DOMAINS.flatMap((domain) =>
      Array.from({ length: perDomain }, (_, i) => ({
        code: `${domain}-${String(i + 1).padStart(3, "0")}`,
        domain,
        sourceRef: SAMPLE_REF[domain],
        sourceTask: BABOK_TASKS[SAMPLE_REF[domain]].name,
        difficulty,
        stem: `Scenario ${domain}-${i}: the analyst must decide what to do next on the programme.`,
        explanation: `The BABOK guidance for ${domain} explains the expected next step here.`,
        status: "active" as const,
        options: OPTION_LABELS.map((label) => ({
          label,
          text: `${label} option for ${domain}-${i}`,
          rationale: `Reasoning for ${label}`,
          isCorrect: label === "A",
        })),
      })),
    ),
  };
}

/** Seeds the catalog and, optionally, a question bank. Returns nothing. */
export function seedCatalogAndBank(db: Db, perDomain = 0, options: BankOptions = {}): void {
  importCatalog(db, testFrameworks, testCertifications);
  if (perDomain > 0) importQuestionPack(db, sampleBank(perDomain, options));
}
