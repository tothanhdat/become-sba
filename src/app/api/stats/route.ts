import { errorResponse, json } from "@/app/api/_http";
import { getReadiness, getSessionHistory } from "@/lib/analytics";
import { getCertification } from "@/lib/catalog";
import { db } from "@/lib/db";
import { getBankCoverage, loadReviewPool } from "@/lib/exam/sessions";
import { getDeckStats } from "@/lib/srs/decks";

/** Everything the dashboard needs for one certification, in one round trip. */
export async function GET(request: Request): Promise<Response> {
  try {
    const code = new URL(request.url).searchParams.get("certification");
    if (!code) throw new Error("A certification query parameter is required");

    const cert = getCertification(db, code);
    if (!cert) throw new Error(`Certification ${code} does not exist`);

    return json({
      certification: {
        code: cert.code,
        name: cert.name,
        nameVi: cert.nameVi,
        accent: cert.accent,
        framework: cert.framework,
        questionCount: cert.questionCount,
        timeLimitSec: cert.timeLimitSec,
        passThresholdPercent: cert.passThresholdPercent,
        passThresholdSource: cert.passThresholdSource,
        proficiencyLabel: cert.proficiencyLabel,
        domains: cert.domains,
      },
      readiness: getReadiness(db, cert),
      history: getSessionHistory(db, cert, 20),
      decks: getDeckStats(db, cert.framework.id),
      coverage: getBankCoverage(db, cert),
      reviewPoolSize: loadReviewPool(db, cert).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
