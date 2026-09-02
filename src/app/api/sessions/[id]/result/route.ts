import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionResult } from "@/lib/exam/sessions";

/** The post-mortem: explanations, per-option reasoning, BABOK references. */
export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json(getSessionResult(db, session.user.id, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
