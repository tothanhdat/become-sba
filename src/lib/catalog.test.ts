import { beforeEach, describe, expect, test } from "vitest";

import {
  getCertification,
  importCatalog,
  listCertifications,
  type CertificationPack,
  type FrameworkPack,
} from "./catalog";
import { createDatabase, type Db } from "./db";

let db: Db;

const frameworks: FrameworkPack = {
  version: 1,
  frameworks: [
    {
      code: "babok-v3",
      name: "BABOK Guide v3",
      source: "IIBA",
      domainLabel: "Knowledge Area",
      domainLabelVi: "Knowledge Area",
      domains: [
        { code: "BAPM", name: "Planning", nameVi: "Lập kế hoạch", reference: "3", order: 1 },
        { code: "RADD", name: "Analysis", nameVi: "Phân tích", reference: "7", order: 2 },
      ],
    },
    {
      code: "ba-standard",
      name: "BA Standard",
      source: "IIBA",
      domainLabel: "Performance Domain",
      domainLabelVi: "Performance Domain",
      domains: [{ code: "UBA", name: "Understanding", nameVi: "Hiểu", order: 1 }],
    },
  ],
};

function cert(over: Partial<CertificationPack["certifications"][number]> = {}) {
  return {
    code: "CBAP",
    name: "Certified Business Analysis Professional",
    nameVi: "CBAP",
    body: "IIBA",
    tier: "Senior",
    frameworkCode: "babok-v3",
    questionCount: 120,
    timeLimitSec: 12600,
    passThresholdPercent: 70,
    passThresholdSource: "Community estimate",
    proficiencyLevel: 3 as const,
    proficiencyLabel: "Level 3 — Expert",
    allowsCaseStudies: true,
    questionTypes: "case-study and scenario-based",
    eligibility: "7,500 hours",
    accent: "indigo" as const,
    order: 1,
    domainWeights: { BAPM: 40, RADD: 60 },
    ...over,
  };
}

const certs = (...list: ReturnType<typeof cert>[]): CertificationPack => ({
  version: 1,
  certifications: list,
});

beforeEach(() => {
  db = createDatabase(":memory:");
});

describe("importCatalog", () => {
  test("loads frameworks, their domains, and the certifications on them", () => {
    const result = importCatalog(db, frameworks, certs(cert()));
    expect(result).toMatchObject({ frameworks: 2, domains: 3, certifications: 1 });
  });

  test("is idempotent, so re-seeding does not duplicate anything", () => {
    importCatalog(db, frameworks, certs(cert()));
    importCatalog(db, frameworks, certs(cert()));
    expect(listCertifications(db)).toHaveLength(1);
    expect(getCertification(db, "CBAP")!.domains).toHaveLength(2);
  });

  test("rejects a certification pointing at a framework that does not exist", () => {
    expect(() => importCatalog(db, frameworks, certs(cert({ frameworkCode: "pmbok" })))).toThrow(/pmbok/);
  });

  test("rejects a weight for a domain outside the certification's framework", () => {
    expect(() =>
      importCatalog(db, frameworks, certs(cert({ domainWeights: { BAPM: 50, UBA: 50 } }))),
    ).toThrow(/UBA/);
  });

  test("rejects a certification that does not weight every domain of its framework", () => {
    expect(() =>
      importCatalog(db, frameworks, certs(cert({ domainWeights: { RADD: 100 } }))),
    ).toThrow(/BAPM/);
  });

  test("rejects weights that do not sum to 100", () => {
    expect(() =>
      importCatalog(db, frameworks, certs(cert({ domainWeights: { BAPM: 40, RADD: 50 } }))),
    ).toThrow(/100/);
  });

  test("updates an existing certification rather than inserting a second", () => {
    importCatalog(db, frameworks, certs(cert()));
    importCatalog(db, frameworks, certs(cert({ questionCount: 125 })));
    expect(getCertification(db, "CBAP")!.questionCount).toBe(125);
  });
});

describe("getCertification", () => {
  beforeEach(() => {
    importCatalog(db, frameworks, certs(cert()));
  });

  test("returns the certification with its framework and weighted domains", () => {
    const c = getCertification(db, "CBAP")!;
    expect(c.framework.code).toBe("babok-v3");
    expect(c.proficiencyLevel).toBe(3);
    expect(c.allowsCaseStudies).toBe(true);
    expect(c.domains.map((d) => [d.code, d.weight])).toEqual([["BAPM", 40], ["RADD", 60]]);
  });

  test("orders domains by their position in the framework, not by weight", () => {
    expect(getCertification(db, "CBAP")!.domains.map((d) => d.code)).toEqual(["BAPM", "RADD"]);
  });

  test("returns null for a certification that does not exist", () => {
    expect(getCertification(db, "PMP")).toBeNull();
  });
});

describe("listCertifications", () => {
  test("lists certifications in their configured order", () => {
    importCatalog(
      db,
      frameworks,
      certs(
        cert({ code: "CBAP", order: 2 }),
        cert({ code: "ECBA", frameworkCode: "ba-standard", order: 0, domainWeights: { UBA: 100 }, proficiencyLevel: 1, allowsCaseStudies: false }),
        cert({ code: "CCBA", order: 1 }),
      ),
    );
    expect(listCertifications(db).map((c) => c.code)).toEqual(["ECBA", "CCBA", "CBAP"]);
  });
});
