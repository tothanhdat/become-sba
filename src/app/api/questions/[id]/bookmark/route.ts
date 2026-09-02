import { errorResponse, json, numericParam, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toggleBookmark } from "@/lib/notes";

export async function POST(_request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    return json({ bookmarked: toggleBookmark(db, session.user.id, await numericParam(ctx.params)) });
  } catch (error) {
    return errorResponse(error);
  }
}
