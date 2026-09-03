import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// zodOutputFormat's type is bound to zod/v4's ZodType, not the classic v3 API
// the rest of this codebase uses (src/lib/content/schema.ts) — this import is
// scoped to this one file, required by the SDK helper's own type signature.
import * as z from "zod/v4";

import { OPTION_LABELS } from "./domain";
import type { Translator } from "./translate";

const translationSchema = z.object({
  stem: z.string(),
  options: z.array(z.object({ label: z.enum(OPTION_LABELS), text: z.string() })).length(4),
  caseStudyTitle: z.string().nullable(),
  caseStudyBody: z.string().nullable(),
});

// Constructed lazily, not at module load: this file is imported by the route
// module, which api.test.ts imports too, and the SDK throws if it can't
// resolve credentials — importing must not require a real API key.
let client: Anthropic | undefined;
function getClient(): Anthropic {
  return (client ??= new Anthropic());
}

/**
 * Translates one question's English content to Vietnamese via Claude.
 * Wired into `translateQuestion` at the API route; kept separate so the
 * caching/orchestration logic in translate.ts can be tested without a
 * live API call.
 */
export const translateWithClaude: Translator = async ({ stem, options, caseStudy }) => {
  const response = await getClient().messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    system:
      "You translate IIBA BABOK v3 business analysis exam content from English to Vietnamese for a BA " +
      "certification prep app. Keep the meaning and difficulty exactly as in the source — this is an exam " +
      "question, not marketing copy. Preserve BABOK task and technique names naturally; a Vietnamese-speaking " +
      "BA professional should immediately recognize standard terms. Keep numbers, option labels, and any " +
      "quoted requirement text intact.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          stem,
          options,
          caseStudy,
        }),
      },
    ],
    output_config: { format: zodOutputFormat(translationSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude did not return a valid translation");

  return {
    stem: parsed.stem,
    options: parsed.options,
    caseStudy: caseStudy ? { title: parsed.caseStudyTitle ?? caseStudy.title, body: parsed.caseStudyBody ?? caseStudy.body } : null,
  };
};
