import { errorResponse, json } from "@/app/api/_http";
import { listCertifications } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage } from "@/lib/exam/sessions";

/**
 * The certification picker's data source.
 *
 * Each entry carries how many questions it can actually serve, which is not the
 * size of the bank: a certification only sees its own framework, and only
 * questions at or below its proficiency level.
 */
export async function GET(): Promise<Response> {
  try {
    const certifications = listCertifications(db).map((cert) => {
      const coverage = getBankCoverage(db, cert);
      return {
        code: cert.code,
        name: cert.name,
        nameVi: cert.nameVi,
        body: cert.body,
        tier: cert.tier,
        accent: cert.accent,
        framework: cert.framework,
        questionCount: cert.questionCount,
        timeLimitSec: cert.timeLimitSec,
        passThresholdPercent: cert.passThresholdPercent,
        passThresholdSource: cert.passThresholdSource,
        proficiencyLabel: cert.proficiencyLabel,
        questionTypes: cert.questionTypes,
        eligibility: cert.eligibility,
        domains: cert.domains,
        availableQuestions: coverage.total,
        availableByDomain: coverage.byDomain,
        ready: coverage.total > 0,
      };
    });
    return json({ certifications });
  } catch (error) {
    return errorResponse(error);
  }
}
