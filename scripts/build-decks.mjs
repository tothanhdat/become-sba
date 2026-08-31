/**
 * Generate the flashcard decks from the BABOK v3 text.
 *
 * Decks are derived from the guide rather than hand-typed, so every card's
 * content is accurate by construction and can be regenerated when the source
 * changes. Run after scripts/extract-babok.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2] ?? "content/babok/babokv3.txt";
const raw = readFileSync(SRC, "utf8");

/** Page furniture that the PDF repeats on every page. */
const NOISE = [
  /^=====\s*PAGE\s+\d+\s*=====$/,
  /^Complimentary IIBA$/,
  /^®$/,
  /^Member Copy\. Not for Distribution or Resale\.$/,
  /^\d{1,3}$/,
];

const lines = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => !NOISE.some((n) => n.test(l)));

const text = lines.join("\n");

/** Collapse the PDF's hard-wrapped lines into one paragraph. */
const unwrap = (s) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- techniques

function buildTechniques() {
  const cards = [];
  for (let n = 1; n <= 50; n++) {
    const ref = `10.${n}`;
    const name = headingAbove(ref);
    const purpose = firstSentences(subsection(ref, 1).join(" "));
    if (!name || !purpose) throw new Error(`Could not extract technique ${ref}`);
    cards.push({
      code: `TECH-${String(n).padStart(2, "0")}`,
      front: name,
      back: purpose,
      babokRef: ref,
    });
  }
  return { version: 1, deck: "techniques", cards };
}

// --------------------------------------------------------------------- tasks

const KA_BY_CHAPTER = { 3: "BAPM", 4: "EC", 5: "RLCM", 6: "SA", 7: "RADD", 8: "SE" };

const TASK_REFS = [
  "3.1", "3.2", "3.3", "3.4", "3.5",
  "4.1", "4.2", "4.3", "4.4", "4.5",
  "5.1", "5.2", "5.3", "5.4", "5.5",
  "6.1", "6.2", "6.3", "6.4",
  "7.1", "7.2", "7.3", "7.4", "7.5", "7.6",
  "8.1", "8.2", "8.3", "8.4", "8.5",
];

function buildTasks() {
  const cards = [];
  for (const ref of TASK_REFS) {
    const ka = KA_BY_CHAPTER[Number(ref.split(".")[0])];
    const name = taskName(ref);
    const purpose = sectionText(ref, 1);
    const inputs = bulletNames(ref, 3);
    const elements = elementNames(ref);
    const outputs = bulletNames(ref, 8);

    if (!name || !purpose) throw new Error(`Could not extract task ${ref}`);

    const back = [
      `Purpose: ${purpose}`,
      inputs.length ? `Inputs: ${inputs.join("; ")}` : null,
      elements.length ? `Elements: ${elements.join("; ")}` : null,
      outputs.length ? `Outputs: ${outputs.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    cards.push({ code: `TASK-${ref}`, front: `${ref} ${name}`, back, ka, babokRef: ref });
  }
  return { version: 1, deck: "tasks", cards };
}

// ------------------------------------------------------------------ glossary

function buildGlossary() {
  // The title also appears in the table of contents, so take the last hit.
  const start = text.lastIndexOf("Appendix A: Glossary");
  const end = text.indexOf("Appendix B", start);
  if (start < 0 || end < 0) throw new Error("Could not locate the glossary appendix");

  const body = text.slice(start, end).split("\n");

  // An entry starts at the beginning of a line as "term: definition", optionally
  // preceded by the single-letter alphabet marker the guide prints in the
  // margin ("a acceptance criteria: ..."). Wrapped continuation lines never
  // match, which is what keeps mid-sentence colons out of the deck.
  const entryStart = /^(?:[a-z] )?([a-z][a-zA-Z0-9 ®'\-/()]{2,55}):\s+([A-Z].*)$/;

  const entries = [];
  for (const line of body) {
    const m = line.match(entryStart);
    if (m) entries.push({ name: m[1].trim(), parts: [m[2]] });
    else if (entries.length > 0) entries.at(-1).parts.push(line);
  }

  const cards = [];
  const seen = new Set();
  for (const entry of entries) {
    const definition = unwrap(entry.parts.join(" "));
    // Cross-references ("allocation: See requirements allocation.") teach nothing.
    if (/^See\b/i.test(definition)) continue;
    if (definition.length < 25 || definition.length > 700) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      code: `GLOS-${String(cards.length + 1).padStart(3, "0")}`,
      front: entry.name,
      back: definition,
    });
  }

  if (cards.length < 80) throw new Error(`Glossary extraction looks wrong: only ${cards.length} cards`);
  return { version: 1, deck: "glossary", cards };
}

// ------------------------------------------------------------------- helpers

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAfter(re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/**
 * The heading immediately above "<ref>.1 Purpose".
 *
 * Searching upward from the body avoids the table of contents, whose entries
 * look identical apart from a trailing page number.
 */
function headingAbove(ref) {
  const idx = lines.findIndex((l) => l === `${ref}.1 Purpose`);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= Math.max(0, idx - 12); i--) {
    const m = lines[i].match(new RegExp(`^${escape(ref)}\\s+([A-Z][A-Za-z0-9 ,'\\-/&()]{3,60})$`));
    if (m) return m[1].replace(/\s+\d{1,3}$/, "").trim();
  }
  return null;
}

const taskName = headingAbove;

/**
 * The opening sentences of a passage.
 *
 * Chapter 10 has no "The purpose of..." formula, and the PDF leaves a running
 * header glued to the end of each extracted block. Taking whole sentences and
 * stopping at a length budget drops that trailing fragment, which never ends in
 * a full stop.
 */
function firstSentences(passage, maxChars = 400) {
  const body = unwrap(passage);
  const sentences = body.match(/[^.]+\.(?=\s|$)/g);
  if (!sentences) return null;

  const kept = [];
  for (const sentence of sentences) {
    if (kept.join(" ").length + sentence.length > maxChars && kept.length > 0) break;
    kept.push(sentence.trim());
    if (kept.length === 3) break;
  }
  return kept.join(" ") || null;
}

/** Lines belonging to subsection "<ref>.<n>", up to the next subsection. */
function subsection(ref, n) {
  const startIdx = lines.findIndex((l) => new RegExp(`^${escape(ref)}\\.${n}\\s+[A-Z]`).test(l));
  if (startIdx < 0) return [];
  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (new RegExp(`^${escape(ref)}\\.\\d\\s+[A-Z]`).test(lines[i])) break;
    if (/^\d{1,2}\.\d{1,2}\s+[A-Z]/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

/** First sentence of the Purpose subsection. */
function sectionText(ref, n) {
  const body = unwrap(subsection(ref, n).join(" "));
  const m = body.match(/^(The purpose of .*?\.)(?:\s|$)/);
  return m ? m[1] : body.slice(0, 300) || null;
}

/** Inputs and Outputs appear as "• Name (qualifier): description". */
function bulletNames(ref, n) {
  const body = subsection(ref, n).join("\n");
  const names = [];
  const re = /•\s*([A-Z][A-Za-z0-9 /\-,]{2,60}(?:\([^)]{1,40}\))?)\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = unwrap(m[1]);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Element headings inside subsection .4 render as ".1 Model Requirements". */
function elementNames(ref) {
  const names = [];
  for (const line of subsection(ref, 4)) {
    const m = line.match(/^\.\d\s+([A-Z][A-Za-z0-9 ,'\-/&]{3,60})$/);
    if (m && !names.includes(m[1].trim())) names.push(m[1].trim());
  }
  return names;
}

// ---------------------------------------------------------------------- main

const decks = [buildTechniques(), buildTasks(), buildGlossary()];
for (const deck of decks) {
  const path = `content/decks/${deck.deck}.json`;
  writeFileSync(path, JSON.stringify(deck, null, 2) + "\n");
  console.log(`${path}: ${deck.cards.length} cards`);
}
