/**
 * Load the certification catalog, every content pack and every flashcard deck
 * into the local database.
 *
 * Safe to re-run: imports are keyed on stable codes, so this is how the bank
 * grows as new questions are authored.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { importCatalog, listCertifications } from "../src/lib/catalog";
import { importFlashcardDeck, importQuestionPack } from "../src/lib/content/importer";
import { db } from "../src/lib/db";
import { allocateByBlueprint } from "../src/lib/exam/blueprint";
import { getBankCoverage } from "../src/lib/exam/sessions";

// The catalog and pack shapes are validated by Zod at import time, so the
// loader stays deliberately untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

function loadDir(dir: string, load: (data: any, name: string) => void): void {
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    load(readJson(join(dir, name)), name);
  }
}

// The catalog has to land first: packs resolve their domains against it.
const catalog = importCatalog(
  db,
  readJson("content/catalog/frameworks.json"),
  readJson("content/catalog/certifications.json"),
);
console.log(
  `Catalog: ${catalog.frameworks} frameworks, ${catalog.domains} domains, ${catalog.certifications} certifications.\n`,
);

let inserted = 0;
let updated = 0;
const rejected: { code: string; reason: string }[] = [];

loadDir("content/packs", (data, name) => {
  const result = importQuestionPack(db, data);
  inserted += result.questionsInserted;
  updated += result.questionsUpdated;
  rejected.push(...result.rejected);
  console.log(
    `  ${name}: +${result.questionsInserted} new, ${result.questionsUpdated} updated` +
      (result.rejected.length ? `, ${result.rejected.length} held back` : ""),
  );
});

loadDir("content/decks", (data, name) => {
  const result = importFlashcardDeck(db, data);
  console.log(`  ${name}: +${result.inserted} new, ${result.updated} updated`);
});

console.log(`\nQuestions: ${inserted} inserted, ${updated} updated.`);

if (rejected.length > 0) {
  console.log(`\n${rejected.length} question(s) held back as drafts — fix the citation and re-seed:`);
  for (const r of rejected) console.log(`  ${r.code}: ${r.reason}`);
}

// Coverage per certification. A certification serves only the questions its own
// proficiency level and question-type rules allow, so the same bank yields a
// different count for each one.
for (const cert of listCertifications(db)) {
  const coverage = getBankCoverage(db, cert);
  const needed = allocateByBlueprint(
    cert.questionCount,
    cert.domains.map((d) => ({ code: d.code, weight: d.weight })),
  );

  console.log(
    `\n${cert.code} — ${cert.framework.name} · ${cert.proficiencyLabel}` +
      `${cert.allowsCaseStudies ? "" : " · no case studies"}`,
  );
  console.log(`  Eligible questions: ${coverage.total} (a full mock needs ${cert.questionCount})`);

  if (coverage.total === 0) {
    console.log("  No content yet. The blueprint is configured and ready for authoring.");
    continue;
  }

  const label = cert.framework.domainLabel;
  console.log(`  ${label.padEnd(18)} eligible   needed`);
  let short = 0;
  for (const d of cert.domains) {
    const have = coverage.byDomain[d.code] ?? 0;
    const need = needed[d.code];
    if (have < need) short += need - have;
    console.log(
      `  ${d.code.padEnd(18)} ${String(have).padStart(8)} ${String(need).padStart(8)}` +
        (have < need ? "  <-- short" : ""),
    );
  }
  if (short > 0) console.log(`  Short ${short} question(s) for a faithful full-length mock.`);
}
