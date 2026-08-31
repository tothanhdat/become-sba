import { z } from "zod";

import { errorResponse, json, numericParam, readJson, type RouteContext } from "@/app/api/_http";
import { db } from "@/lib/db";
import { getNote, saveNote } from "@/lib/notes";

const bodySchema = z.object({ body: z.string() });

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const questionId = await numericParam(ctx.params);
    const { body } = bodySchema.parse(await readJson(request));
    saveNote(db, questionId, body);
    return json({ note: getNote(db, questionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
