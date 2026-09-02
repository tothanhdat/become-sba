import { z } from "zod";

import { errorResponse, json, unauthorized } from "@/app/api/_http";
import { getCertification } from "@/lib/catalog";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECKS } from "@/lib/domain";
import { getDueCards } from "@/lib/srs/decks";

const querySchema = z.object({
  /** Optional: scope to the decks of this certification's framework. */
  certification: z.string().min(1).max(16).optional(),
  deck: z.enum(DECKS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) return unauthorized();

    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      certification: params.get("certification") ?? undefined,
      deck: params.get("deck") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    let frameworkId: number | undefined;
    if (query.certification) {
      const cert = getCertification(db, query.certification);
      if (!cert) throw new Error(`Certification ${query.certification} does not exist`);
      frameworkId = cert.framework.id;
    }

    return json(getDueCards(db, session.user.id, { frameworkId, deck: query.deck, limit: query.limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
