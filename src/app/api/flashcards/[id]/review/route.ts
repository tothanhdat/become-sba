import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { REVIEW_GRADES } from "@/lib/domain";
import { reviewCard } from "@/lib/srs/decks";

const bodySchema = z.object({
  button: z.enum(Object.keys(REVIEW_GRADES) as [string, ...string[]]),
});

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const cardId = await numericParam(ctx.params);
    const { button } = bodySchema.parse(await readJson(request));
    return json(reviewCard(db, session.user.id, cardId, button as keyof typeof REVIEW_GRADES));
  } catch (error) {
    return errorResponse(error);
  }
}
