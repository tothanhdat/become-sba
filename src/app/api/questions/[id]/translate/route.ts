import { errorResponse, json, numericParam, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { translateQuestion } from "@/lib/translate";
import { translateWithClaude } from "@/lib/translateClient";

/**
 * Returns this question's Vietnamese translation, translating and caching it
 * on first request. Catalog data shared by every learner — no sign-in
 * required, unlike the personal-progress routes.
 */
export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const questionId = await numericParam(ctx.params);
    const translation = await translateQuestion(db, questionId, translateWithClaude);
    return json(translation);
  } catch (error) {
    return errorResponse(error);
  }
}
