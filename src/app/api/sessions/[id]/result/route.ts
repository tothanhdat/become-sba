import { errorResponse, json, numericParam, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { getSessionResult } from "@/lib/exam/sessions";

/** The post-mortem: explanations, per-option reasoning, BABOK references. */
export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    return json(getSessionResult(db, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
