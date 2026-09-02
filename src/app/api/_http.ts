import { ZodError } from "zod";

/**
 * Turn a thrown Error into an HTTP response.
 *
 * The service layer throws plain Errors with readable messages, so the mapping
 * lives here rather than making every service import HTTP concerns.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return json({ error: "Invalid request", issues: error.issues }, 400);
  }

  const message = error instanceof Error ? error.message : "Unexpected error";

  if (/does not exist|is not part of/i.test(message)) return json({ error: message }, 404);
  if (/already submitted|has not been submitted/i.test(message)) return json({ error: message }, 409);

  return json({ error: message }, 400);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function unauthorized(): Response {
  return json({ error: "Sign-in required" }, 401);
}

/** Parse a numeric path segment, rejecting anything that is not a positive integer. */
export async function numericParam(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid id: ${id}`);
  return value;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

export type RouteContext = { params: Promise<{ id: string }> };
