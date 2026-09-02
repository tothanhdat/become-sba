import { z } from "zod";

import { errorResponse, json, numericParam, readJson, unauthorized, type RouteContext } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getNote, saveNote } from "@/lib/notes";

const bodySchema = z.object({ body: z.string() });

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const questionId = await numericParam(ctx.params);
    const { body } = bodySchema.parse(await readJson(request));
    saveNote(db, session.user.id, questionId, body);
    return json({ note: getNote(db, session.user.id, questionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
