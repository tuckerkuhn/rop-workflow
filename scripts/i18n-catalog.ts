/**
 * The translators' list: every sentence a screen shows through tx("...") or marks with msg("..."),
 * with its Spanish, Dari and Pashto so far (src/lib/i18n/text/*.ts). Writes
 * docs/translation/screen-text.csv and prints how much of each language is done.
 *
 *   npm run i18n:catalog
 *
 * A tx() whose argument is not a plain string (a variable, or a template with ${...}) cannot be
 * listed: those are printed as warnings so the screen can pass {placeholders} instead.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { textEs } from "../src/lib/i18n/text/es";
import { textFa } from "../src/lib/i18n/text/fa";
import { textPs } from "../src/lib/i18n/text/ps";

const root = join(__dirname, "..");
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f !== "__tests__" && f !== "node_modules") walk(p);
    } else if (/\.(tsx?|ts)$/.test(f) && !p.includes("/lib/i18n/text")) files.push(p);
  }
};
walk(join(root, "src"));

// tx("..."), tx('...'), tx(`...`) without ${}, and msg(...) the same.
const CALL = /\b(tx|msg)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.|\$(?!\{))*`)/g;
const DYNAMIC = /\btx\(\s*(?!["'`])[^)]/g;
const unquote = (q: string) => JSON.parse(q.startsWith("`") || q.startsWith("'") ? JSON.stringify(q.slice(1, -1).replace(/\\(.)/g, "$1")) : q) as string;

const where = new Map<string, Set<string>>();
const warnings: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = relative(root, f);
  for (const m of src.matchAll(CALL)) {
    const text = unquote(m[2]);
    if (!where.has(text)) where.set(text, new Set());
    where.get(text)!.add(rel);
  }
  for (const m of src.matchAll(DYNAMIC)) {
    const line = src.slice(0, m.index).split("\n").length;
    warnings.push(`${rel}:${line} tx() of a variable: its text is not listed (fine when the variable holds a msg() sentence)`);
  }
}

const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const rows = [...where.keys()].sort((a, b) => a.localeCompare(b));
const csv = ["english,spanish,dari,pashto,where", ...rows.map((t) => [t, textEs[t] ?? "", textFa[t] ?? "", textPs[t] ?? "", [...where.get(t)!].join(" ")].map(cell).join(","))].join("\n");
writeFileSync(join(root, "docs/translation/screen-text.csv"), `${csv}\n`);

const done = (d: Record<string, string>) => rows.filter((t) => d[t]).length;
console.log(`${rows.length} sentences. Spanish ${done(textEs)}, Dari ${done(textFa)}, Pashto ${done(textPs)} translated.`);
console.log("Written to docs/translation/screen-text.csv");
const unused = [textEs, textFa, textPs].flatMap((d) => Object.keys(d)).filter((k) => !where.has(k));
if (unused.length) console.log(`${new Set(unused).size} translated sentences no longer on any screen (the English changed?):\n  ${[...new Set(unused)].slice(0, 20).join("\n  ")}`);
// Usually data marked msg() at its source; list them with --verbose to check none is a free-standing sentence.
if (warnings.length) console.log(process.argv.includes("--verbose") ? `\n${warnings.length} tx() calls with a variable:\n  ${warnings.join("\n  ")}` : `${warnings.length} tx() calls translate data marked msg() at its source (--verbose lists them).`);
