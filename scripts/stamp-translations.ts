/**
 * Stamp every Vietnamese overlay file with the hash of the English text it was
 * translated from, and report how much of the bank is still untranslated.
 *
 * Authoring a translation means writing the Vietnamese and running this — the
 * hashes are derived, never typed by hand. Re-run it after editing any question
 * you have already translated, once the Vietnamese has been brought back in line.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { caseStudySourceHash, questionSourceHash, translationPackSchema } from "../src/lib/content/translations";
import type { OptionLabel } from "../src/lib/domain";

const PACKS_DIR = "content/packs";
const VI_DIR = "content/translations/vi";

interface PackQuestion {
  code: string;
  stem: string;
  explanation: string;
  options: { label: OptionLabel; text: string; rationale: string }[];
}

const english = new Map<string, PackQuestion>();
const englishCases = new Map<string, { title: string; body: string }>();

for (const name of readdirSync(PACKS_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const pack = JSON.parse(readFileSync(join(PACKS_DIR, name), "utf8"));
  for (const q of pack.questions) {
    english.set(q.code, { code: q.code, stem: q.stem, explanation: q.explanation, options: q.options });
  }
  for (const cs of pack.caseStudies ?? []) {
    englishCases.set(cs.code, { title: cs.title, body: cs.body });
  }
}

if (!existsSync(VI_DIR)) mkdirSync(VI_DIR, { recursive: true });

const translated = new Set<string>();
const explained = new Set<string>();
let filesWritten = 0;

for (const name of readdirSync(VI_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(VI_DIR, name);
  const file = JSON.parse(readFileSync(path, "utf8"));

  for (const q of file.questions ?? []) {
    const source = english.get(q.code);
    if (!source) throw new Error(`${name}: ${q.code} is not in any question pack`);
    q.sourceHash = questionSourceHash(source);
    translated.add(q.code);
    // A question counts as fully translated only when the explanation and every
    // option rationale are present too — that is what the review screen shows.
    const rationalesDone =
      Array.isArray(q.options) && q.options.length === 4 && q.options.every((o: { rationale?: string }) => o.rationale);
    if (q.explanation && rationalesDone) explained.add(q.code);
  }

  for (const cs of file.caseStudies ?? []) {
    const source = englishCases.get(cs.code);
    if (!source) throw new Error(`${name}: case study ${cs.code} is not in any question pack`);
    cs.sourceHash = caseStudySourceHash(source);
  }

  // Fail here rather than at seed time, while the file is still in front of you.
  translationPackSchema.parse(file);

  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  filesWritten += 1;
  const done = (file.questions ?? []).filter((q: { code: string }) => explained.has(q.code)).length;
  console.log(`  ${name}: ${(file.questions ?? []).length} stamped, ${done} with explanation + rationales`);
}

const missing = [...english.keys()].filter((code) => !translated.has(code)).sort();

console.log(`\n${filesWritten} file(s) stamped.`);
console.log(`Stem + options: ${translated.size} of ${english.size} question(s).`);
console.log(`Explanation + rationales: ${explained.size} of ${english.size} question(s).`);

const missingDepth = [...translated].filter((code) => !explained.has(code)).sort();
if (missingDepth.length > 0) {
  console.log(`\nStem-only so far (${missingDepth.length}):`);
  console.log(`  ${missingDepth.join(", ")}`);
}

if (missing.length > 0) {
  console.log(`\nStill untranslated (${missing.length}):`);
  console.log(`  ${missing.join(", ")}`);
}
