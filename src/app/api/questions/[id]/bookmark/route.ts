import { errorResponse, json, numericParam, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { toggleBookmark } from "@/lib/notes";

export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    return json({ bookmarked: toggleBookmark(db, await numericParam(ctx.params)) });
  } catch (error) {
    return errorResponse(error);
  }
}
