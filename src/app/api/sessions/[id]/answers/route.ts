import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveAnswer } from "@/lib/exam/sessions";

const bodySchema = z.object({
  questionId: z.number().int().positive(),
  selectedOptionId: z.number().int().positive().nullable().optional(),
  flagged: z.boolean().optional(),
  timeSpentSec: z.number().int().min(0).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const sessionId = await numericParam(ctx.params);
    const { questionId, ...patch } = bodySchema.parse(await readJson(request));
    saveAnswer(db, session.user.id, sessionId, questionId, patch);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
