import { errorResponse, json, numericParam, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { submitSession } from "@/lib/exam/sessions";

export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    return json(submitSession(db, await numericParam(ctx.params)));
  } catch (error) {
    return errorResponse(error);
  }
}
