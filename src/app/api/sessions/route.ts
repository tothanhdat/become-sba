import { z } from "zod";

import { errorResponse, json, readJson, unauthorized } from "@/app/api/_http";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXAM_MODES } from "@/lib/domain";
import { createSession } from "@/lib/exam/sessions";

const bodySchema = z.object({
  certificationCode: z.string().min(1).max(16),
  mode: z.enum(EXAM_MODES),
  /** Domain code within the certification's framework; required for mode "domain". */
  domain: z.string().min(1).max(12).optional(),
  total: z.number().int().min(1).max(400).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();
    const body = bodySchema.parse(await readJson(request));
    return json({ sessionId: createSession(db, session.user.id, body) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
