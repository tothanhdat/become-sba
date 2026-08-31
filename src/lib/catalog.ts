import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "./db";
import { certificationDomains, certifications, domains, frameworks } from "./db/schema";
import { ACCENTS, type Accent, type Difficulty } from "./domain";

/**
 * The certification catalog: which bodies of knowledge exist, how each
 * certification divides them, and how heavily it weights each division.
 *
 * This is the file that makes the app more than a CBAP app. Everything that
 * used to be a hardcoded constant — six knowledge areas, 30/15/15/14/14/12,
 * 120 questions, 210 minutes — is a row here.
 */

const domainSchema = z.object({
  code: z.string().min(1).max(12),
  name: z.string().min(1),
  nameVi: z.string().min(1),
  reference: z.string().optional(),
  order: z.number().int().min(0),
});

export const frameworkPackSchema = z.object({
  version: z.literal(1),
  frameworks: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        source: z.string().min(1),
        domainLabel: z.string().min(1),
        domainLabelVi: z.string().min(1),
        domains: z.array(domainSchema).min(1),
      }),
    )
    .min(1),
});

export const certificationPackSchema = z.object({
  version: z.literal(1),
  note: z.string().optional(),
  certifications: z
    .array(
      z.object({
        code: z.string().min(1).max(16),
        name: z.string().min(1),
        nameVi: z.string().min(1),
        body: z.string().min(1),
        tier: z.string().min(1),
        frameworkCode: z.string().min(1),
        questionCount: z.number().int().min(1).max(400),
        timeLimitSec: z.number().int().min(60),
        passThresholdPercent: z.number().int().min(1).max(100),
        passThresholdSource: z.string().min(1),
        proficiencyLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        proficiencyLabel: z.string().min(1),
        allowsCaseStudies: z.boolean(),
        questionTypes: z.string().min(1),
        eligibility: z.string().min(1),
        accent: z.enum(ACCENTS),
        order: z.number().int().min(0),
        domainWeights: z.record(z.string(), z.number().int().min(0).max(100)),
      }),
    )
    .min(1),
});

export type FrameworkPack = z.input<typeof frameworkPackSchema>;
export type CertificationPack = z.input<typeof certificationPackSchema>;

export interface CertificationDomain {
  id: number;
  code: string;
  name: string;
  nameVi: string;
  reference: string | null;
  sortOrder: number;
  /** This certification's weighting of the domain, in percent. */
  weight: number;
}

export interface Framework {
  id: number;
  code: string;
  name: string;
  source: string;
  domainLabel: string;
  domainLabelVi: string;
}

export interface Certification {
  id: number;
  code: string;
  name: string;
  nameVi: string;
  body: string;
  tier: string;
  framework: Framework;
  questionCount: number;
  timeLimitSec: number;
  passThresholdPercent: number;
  passThresholdSource: string;
  proficiencyLevel: Difficulty;
  proficiencyLabel: string;
  allowsCaseStudies: boolean;
  questionTypes: string;
  eligibility: string;
  accent: Accent;
  sortOrder: number;
  /** In framework order, each carrying this certification's weight. */
  domains: CertificationDomain[];
}

export interface CatalogImportResult {
  frameworks: number;
  domains: number;
  certifications: number;
}

export function importCatalog(
  db: Db,
  rawFrameworks: FrameworkPack,
  rawCertifications: CertificationPack,
): CatalogImportResult {
  const fwPack = frameworkPackSchema.parse(rawFrameworks);
  const certPack = certificationPackSchema.parse(rawCertifications);

  const result: CatalogImportResult = { frameworks: 0, domains: 0, certifications: 0 };

  db.transaction((tx) => {
    const frameworkIdByCode = new Map<string, number>();
    const domainIdByKey = new Map<string, number>();

    for (const fw of fwPack.frameworks) {
      const row = {
        code: fw.code,
        name: fw.name,
        source: fw.source,
        domainLabel: fw.domainLabel,
        domainLabelVi: fw.domainLabelVi,
      };
      tx.insert(frameworks)
        .values(row)
        .onConflictDoUpdate({ target: frameworks.code, set: row })
        .run();

      const stored = tx
        .select({ id: frameworks.id })
        .from(frameworks)
        .where(eq(frameworks.code, fw.code))
        .get()!;
      frameworkIdByCode.set(fw.code, stored.id);
      result.frameworks += 1;

      for (const d of fw.domains) {
        const dRow = {
          frameworkId: stored.id,
          code: d.code,
          name: d.name,
          nameVi: d.nameVi,
          reference: d.reference ?? null,
          sortOrder: d.order,
        };
        tx.insert(domains)
          .values(dRow)
          .onConflictDoUpdate({
            target: [domains.frameworkId, domains.code],
            set: { name: d.name, nameVi: d.nameVi, reference: d.reference ?? null, sortOrder: d.order },
          })
          .run();
        result.domains += 1;
      }

      for (const d of tx.select().from(domains).where(eq(domains.frameworkId, stored.id)).all()) {
        domainIdByKey.set(`${fw.code}:${d.code}`, d.id);
      }
    }

    for (const c of certPack.certifications) {
      const frameworkId = frameworkIdByCode.get(c.frameworkCode);
      if (frameworkId === undefined) {
        throw new Error(`Certification ${c.code} references unknown framework ${c.frameworkCode}`);
      }

      const frameworkDomains = fwPack.frameworks.find((f) => f.code === c.frameworkCode)!.domains;
      const known = new Set(frameworkDomains.map((d) => d.code));

      for (const code of Object.keys(c.domainWeights)) {
        if (!known.has(code)) {
          throw new Error(
            `Certification ${c.code} weights domain ${code}, which is not part of framework ${c.frameworkCode}`,
          );
        }
      }
      const missing = frameworkDomains.filter((d) => !(d.code in c.domainWeights));
      if (missing.length > 0) {
        throw new Error(
          `Certification ${c.code} is missing a weight for ${missing.map((d) => d.code).join(", ")}`,
        );
      }
      const weightSum = Object.values(c.domainWeights).reduce((a, b) => a + b, 0);
      if (weightSum !== 100) {
        throw new Error(`Certification ${c.code} weights sum to ${weightSum}, expected 100`);
      }

      const row = {
        code: c.code,
        name: c.name,
        nameVi: c.nameVi,
        body: c.body,
        tier: c.tier,
        frameworkId,
        questionCount: c.questionCount,
        timeLimitSec: c.timeLimitSec,
        passThresholdPercent: c.passThresholdPercent,
        passThresholdSource: c.passThresholdSource,
        proficiencyLevel: c.proficiencyLevel as Difficulty,
        proficiencyLabel: c.proficiencyLabel,
        allowsCaseStudies: c.allowsCaseStudies,
        questionTypes: c.questionTypes,
        eligibility: c.eligibility,
        accent: c.accent,
        sortOrder: c.order,
      };
      tx.insert(certifications)
        .values(row)
        .onConflictDoUpdate({ target: certifications.code, set: row })
        .run();

      const certId = tx
        .select({ id: certifications.id })
        .from(certifications)
        .where(eq(certifications.code, c.code))
        .get()!.id;

      for (const [code, weight] of Object.entries(c.domainWeights)) {
        const domainId = domainIdByKey.get(`${c.frameworkCode}:${code}`)!;
        tx.insert(certificationDomains)
          .values({ certificationId: certId, domainId, weight })
          .onConflictDoUpdate({
            target: [certificationDomains.certificationId, certificationDomains.domainId],
            set: { weight },
          })
          .run();
      }
      result.certifications += 1;
    }
  });

  return result;
}

function hydrate(db: Db, row: typeof certifications.$inferSelect): Certification {
  const fw = db.select().from(frameworks).where(eq(frameworks.id, row.frameworkId)).get()!;

  const domainRows = db
    .select({
      id: domains.id,
      code: domains.code,
      name: domains.name,
      nameVi: domains.nameVi,
      reference: domains.reference,
      sortOrder: domains.sortOrder,
      weight: certificationDomains.weight,
    })
    .from(certificationDomains)
    .innerJoin(domains, eq(domains.id, certificationDomains.domainId))
    .where(eq(certificationDomains.certificationId, row.id))
    .orderBy(asc(domains.sortOrder))
    .all();

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameVi: row.nameVi,
    body: row.body,
    tier: row.tier,
    framework: {
      id: fw.id,
      code: fw.code,
      name: fw.name,
      source: fw.source,
      domainLabel: fw.domainLabel,
      domainLabelVi: fw.domainLabelVi,
    },
    questionCount: row.questionCount,
    timeLimitSec: row.timeLimitSec,
    passThresholdPercent: row.passThresholdPercent,
    passThresholdSource: row.passThresholdSource,
    proficiencyLevel: row.proficiencyLevel,
    proficiencyLabel: row.proficiencyLabel,
    allowsCaseStudies: row.allowsCaseStudies,
    questionTypes: row.questionTypes,
    eligibility: row.eligibility,
    accent: row.accent,
    sortOrder: row.sortOrder,
    domains: domainRows,
  };
}

export function getCertification(db: Db, code: string): Certification | null {
  const row = db.select().from(certifications).where(eq(certifications.code, code)).get();
  return row ? hydrate(db, row) : null;
}

export function getCertificationById(db: Db, id: number): Certification | null {
  const row = db.select().from(certifications).where(eq(certifications.id, id)).get();
  return row ? hydrate(db, row) : null;
}

export function listCertifications(db: Db): Certification[] {
  return db
    .select()
    .from(certifications)
    .orderBy(asc(certifications.sortOrder), asc(certifications.code))
    .all()
    .map((row) => hydrate(db, row));
}
