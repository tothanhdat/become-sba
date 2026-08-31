import { errorResponse, json, numericParam, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { getSessionForTaking } from "@/lib/exam/sessions";

/** The in-progress view. Carries no answer key — see getSessionForTaking. */
export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    return json(getSessionForTaking(db, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
