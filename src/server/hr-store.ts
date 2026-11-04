import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DEFAULT_STEPS, fold, type Entry, type Fields, type Integrity, type ProposalInput, type Rules } from "@/lib/hr";

/**
 * Reads and writes the HR ledger. The database numbers, timestamps and hashes every entry
 * (migration 0017); this module only appends, and checks the chain again on every read with its
 * own code, so a change made around both the app and the database triggers still shows.
 */

/** Which book this server writes to. Sample data lives in "demo", which may be cleared; real records go in a book that never can. */
export const hrBook = () => process.env.HR_BOOK || "demo";
export const isSampleBook = () => hrBook().startsWith("demo");

export const todayIso = () => new Date().toISOString().slice(0, 10);

type Row = { n: number; book: string; at_text: string; actor: string; kind: string; subject: string | null; data_text: string; prev_hash: string; hash: string };

async function rows(book: string): Promise<Row[]> {
  return (await db.execute(sql`
    SELECT n, book, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_text,
           actor, kind, subject, data::text AS data_text, prev_hash, hash
    FROM hr_ledger WHERE book = ${book} ORDER BY n`)) as unknown as Row[];
}

const hashOf = (r: Row) => createHash("sha256").update([r.prev_hash, r.book, String(r.n), r.at_text, r.actor, r.kind, r.subject ?? "", r.data_text].join("|"), "utf8").digest("hex");

/** Every entry recomputed from its contents and checked against the one before. */
function verify(list: Row[]): Omit<Integrity, "lastSeal" | "unsealed"> {
  let prev = "genesis";
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.n !== i + 1) return { ok: false, entries: list.length, brokenAt: i + 1, problem: `Entry ${i + 1} is missing: the numbers jump to ${r.n}.` };
    if (r.prev_hash !== prev) return { ok: false, entries: list.length, brokenAt: r.n, problem: `Entry ${r.n} does not follow from entry ${r.n - 1}.` };
    if (hashOf(r) !== r.hash) return { ok: false, entries: list.length, brokenAt: r.n, problem: `Entry ${r.n} was changed after it was written.` };
    prev = r.hash;
  }
  return { ok: true, entries: list.length, brokenAt: null, problem: null };
}

const toEntry = (r: Row): Entry => ({ n: r.n, at: r.at_text, actor: r.actor, kind: r.kind, subject: r.subject, data: JSON.parse(r.data_text), hash: r.hash, prevHash: r.prev_hash });

/** The whole book, folded for today, with the chain check. Sample books are filled on first use. */
export async function loadHr() {
  const book = hrBook();
  let list = await rows(book);
  if (!list.length && isSampleBook()) {
    await seedSample();
    list = await rows(book);
  }
  const entries = list.map(toEntry);
  const state = fold(entries, todayIso());
  const check = verify(list);
  const lastSeal = state.seals.at(-1) ?? null;
  // A seal must match the entry it sealed, or someone rewrote the book and re-sealed it.
  const badSeal = state.seals.find((x) => list[x.upTo - 1]?.hash !== x.hash);
  const integrity: Integrity = badSeal
    ? { ...check, ok: false, brokenAt: badSeal.upTo, problem: `The seal of ${badSeal.at.slice(0, 10)} no longer matches entry ${badSeal.upTo}.`, lastSeal, unsealed: 0 }
    : { ...check, lastSeal, unsealed: list.length - (lastSeal?.n ?? 0) };
  return { book, entries, state, integrity };
}

/** Appends one entry and returns its number. */
export async function append(actor: string, kind: string, subject: string | null, data: unknown): Promise<number> {
  // n, at, prev_hash and hash are set by the database trigger; these placeholders are replaced.
  const [r] = await db.insert(s.hrLedger).values({ book: hrBook(), n: 0, actor, kind, subject, data, prevHash: "", hash: "" }).returning({ n: s.hrLedger.n });
  return r.n;
}

/**
 * Seals the book: writes the latest entry's hash as a new entry, and emails it outside the app
 * when HR_SEAL_TO and RESEND_API_KEY are set, so a rewritten book can be caught by comparing.
 */
export async function seal(actor: string) {
  const list = await rows(hrBook());
  const last = list.at(-1);
  if (!last) return { sealed: false, why: "Nothing to seal yet." };
  if (last.kind === "seal") return { sealed: false, why: "Nothing new since the last seal." };
  const to = process.env.HR_SEAL_TO || null;
  let sentTo: string | null = null;
  if (to && process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.HR_SEAL_FROM || "ROP Workflow <onboarding@resend.dev>",
        to: to.split(",").map((x) => x.trim()),
        subject: `HR record seal ${todayIso()}: entry ${last.n}`,
        text: `HR record, book "${last.book}", sealed ${new Date().toISOString()}.\n\nEntries 1 to ${last.n}.\nFingerprint of entry ${last.n}:\n${last.hash}\n\nKeep this email. If the app ever shows a different fingerprint for entry ${last.n}, the record was changed after this date.`,
      }),
    });
    if (res.ok) sentTo = to;
  }
  const n = await append(actor, "seal", null, { upTo: last.n, hash: last.hash, sentTo });
  return { sealed: true, n, upTo: last.n, sentTo };
}

/** Clears a sample book and fills it again. Refused for real books by the code and by the database. */
export async function resetSample() {
  if (!isSampleBook()) throw new Error("Only a sample book can be reset.");
  await db.delete(s.hrLedger).where(eq(s.hrLedger.book, hrBook()));
  await seedSample();
}

/* ---------------- Sample records (fictional people and pay) ---------------- */

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const firstOfNextMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Writes the sample records through `write` (the ledger by default). */
export async function seedSample(write: typeof append = append) {
  const today = todayIso();
  const rules: Rules = { steps: DEFAULT_STEPS, holders: { hr: ["sima", "mina"], cfo: ["peter"], ceo: ["grace"], board: ["arthur"] } };
  await write("sima", "start", null, { rules });

  const usd = (pay: number): Fields => ({ payBasis: "Month", pay, currency: "USD" });
  const afn = (pay: number): Fields => ({ payBasis: "Month", pay, currency: "AFN" });
  const hires: [string, Fields][] = [
    ["grace", { name: "Grace Moreno", title: "Chief Executive Officer", office: "Home Office", employment: "Employee", startDate: "2019-03-01", ...usd(15000), retirementPct: 5 }],
    ["peter", { name: "Peter Hale", title: "Chief Financial Officer", office: "Home Office", employment: "Employee", supervisor: "grace", startDate: "2021-06-01", ...usd(11000), retirementPct: 4 }],
    ["sima", { name: "Sima Rezai", title: "HR Manager", office: "Home Office", employment: "Employee", supervisor: "peter", startDate: "2022-01-10", ...usd(6500), retirementPct: 3 }],
    ["mina", { name: "Mina Sharifi", title: "HR Officer", office: "Afghanistan", employment: "National staff", supervisor: "sima", startDate: "2023-11-01", ...afn(56000) }],
    ["karim", { name: "Karim Ahmadi", title: "Country Director", office: "Afghanistan", employment: "National staff", supervisor: "grace", startDate: "2020-04-01", ...afn(245000), dangerPay: 0, commsAllowance: 3500 }],
    ["nadia", { name: "Nadia Rahimi", title: "Project Manager", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-02-15", ...afn(98000), commsAllowance: 2000, phone: "+93 70 000 0101" }],
    ["yusuf", { name: "Yusuf Mohammadi", title: "Finance Officer", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-05-01", ...afn(70000) }],
    ["zahra", { name: "Zahra Karimi", title: "Procurement Officer", office: "Afghanistan", employment: "National staff", supervisor: "hamid", startDate: "2024-03-01", ...afn(63000) }],
    ["hamid", { name: "Hamid Wardak", title: "Procurement Manager", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2022-09-01", ...afn(84000) }],
    ["farid", { name: "Farid Sultani", title: "Horticulture Specialist", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2024-01-15", contractEnd: "2027-12-31", ...afn(77000) }],
    ["javed", { name: "Javed Mansoor", title: "Sr. Civil Engineer", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-08-01", contractEnd: "2027-12-31", ...afn(91000) }],
    ["bilal", { name: "Bilal Haidari", title: "Storekeeper", office: "Afghanistan", employment: "National staff", supervisor: "nadia", startDate: "2024-06-01", ...afn(35000) }],
  ];
  const propose = (by: string, p: ProposalInput) => write(by, "propose", p.subject, p);
  const approve = (by: string, proposal: number, step: number, as: string, subject: string | null) => write(by, "approve", subject, { proposal, step, as });

  for (const [id, fields] of hires) {
    // Starting records, as if imported from the old HR system. Nobody proposes their own, so Mina enters Sima's.
    const n = await propose(id === "sima" ? "mina" : "sima", { type: "hire", subject: id, effective: fields.startDate as string, fields, reason: "Starting record, imported from the previous HR system." });
    // The CFO cannot sign the CFO step of their own record, nor the CEO the CEO step: those fall to the Board.
    const signer = (step: number) => (step === 0 ? (id === "peter" ? "arthur" : "peter") : id === "grace" ? "arthur" : "grace");
    await approve(signer(0), n, 0, id === "peter" ? "board" : "cfo", id);
    await approve(signer(1), n, 1, id === "grace" ? "board" : "ceo", id);
  }

  // Grace declares she is related to Javed, so his pay changes go past her to the Board.
  await write("grace", "declare", "grace", { a: "grace", b: "javed", relation: "Uncle" });

  // Waiting for the CEO: Farid's annual raise, checked by the CFO.
  const raise = await propose("sima", { type: "update", subject: "farid", effective: firstOfNextMonth(today), fields: { pay: 82000 }, reason: "Annual review: rating Exceeds expectations. Within the ACRP budget line for this post." });
  await approve("peter", raise, 0, "cfo", "farid");

  // Waiting for the CFO: a large, backdated raise for Javed. The CEO step will fall to the Board.
  await propose("sima", { type: "update", subject: "javed", effective: addDays(today, -60), fields: { pay: 110000 }, reason: "Market adjustment requested by the Country Director." });

  // Waiting for HR: Nadia corrects her own phone number.
  await propose("nadia", { type: "update", subject: "nadia", effective: today, fields: { phone: "+93 70 000 0199" }, reason: "New number." });

  // Sent back by the CEO.
  const title = await propose("sima", { type: "update", subject: "hamid", effective: today, fields: { title: "Head of Procurement" }, reason: "Recognise wider responsibilities." });
  await write("grace", "reject", "hamid", { proposal: title, note: "Not in the approved staffing plan. Bring it to the next budget revision." });
}
