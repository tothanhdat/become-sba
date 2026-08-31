/**
 * Extract BABOK v3 text to a plain-text file so question authoring can cite
 * real section numbers instead of guessing them. Output stays out of git.
 */
import { writeFileSync, readFileSync } from "node:fs";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const src = process.argv[2] ?? "content/babok/babokv3.pdf";
const out = process.argv[3] ?? "content/babok/babokv3.txt";

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(src)),
  useSystemFonts: true,
}).promise;

const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  let line = "";
  let lastY = null;
  const lines = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = Math.round(item.transform[5]);
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(line.trim());
      line = "";
    }
    line += item.str;
    lastY = y;
  }
  lines.push(line.trim());
  pages.push(`\n===== PAGE ${i} =====\n` + lines.filter(Boolean).join("\n"));
}

writeFileSync(out, pages.join("\n"));
console.log(`pages=${doc.numPages} chars=${pages.join("").length} -> ${out}`);
