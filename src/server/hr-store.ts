import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { prefill, type Sheet } from "@/lib/timesheet";
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
  await db.delete(s.hrFiles).where(eq(s.hrFiles.book, hrBook()));
  await seedSample();
}

/* ---------------- Sample records (fictional people and pay) ---------------- */

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const firstOfNextMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Writes the sample records through `write` (the ledger by default). */
/** A one-page PDF saying it is a sample receipt, so the sample has real files to open. */
function samplePdf(text: string) {
  const content = `BT /F1 14 Tf 40 100 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function storeSampleFile(name: string, text: string, by: string) {
  const buf = samplePdf(text);
  const hash = createHash("sha256").update(buf).digest("hex");
  await db.insert(s.hrFiles).values({ hash, book: hrBook(), name, type: "application/pdf", size: buf.length, data: buf, uploadedBy: by }).onConflictDoNothing();
  return { hash, name, type: "application/pdf", size: buf.length };
}

export async function seedSample(write: typeof append = append, file: typeof storeSampleFile = storeSampleFile) {
  const today = todayIso();
  const rules: Rules = { steps: DEFAULT_STEPS, holders: {
      ceo: ["grace"],
      management: ["karim"],
      cfo: ["peter"],
      finance: ["yusuf", "omid"],
      procurement: ["hamid", "zahra"],
      hr: ["sima", "mina"],
      payroll: ["omid"],
      technical: ["farid", "laila", "javed", "shabnam", "nadia"],
      compliance: ["sarah"],
      board: ["arthur"],
    },
  };
  await write("sima", "start", null, { rules });

  const usd = (pay: number): Fields => ({ payBasis: "Month", pay, currency: "USD" });
  const afn = (pay: number): Fields => ({ payBasis: "Month", pay, currency: "AFN" });
  const hires: [string, Fields][] = [
    ["grace", { name: "Grace Moreno", title: "Chief Executive Officer", office: "Home Office", employment: "Employee", startDate: "2019-03-01", ...usd(15000), retirementPct: 5, adpId: "ROP-1001" }],
    ["peter", { name: "Peter Hale", title: "Chief Financial Officer", office: "Home Office", employment: "Employee", supervisor: "grace", startDate: "2021-06-01", ...usd(11000), retirementPct: 4, adpId: "ROP-1002" }],
    ["sima", { name: "Sima Rezai", title: "HR Manager", office: "Home Office", employment: "Employee", supervisor: "peter", startDate: "2022-01-10", ...usd(6500), retirementPct: 3, adpId: "ROP-1003" }],
    ["omid", { name: "Omid Rahmani", title: "Accounting Manager", office: "Home Office", employment: "Employee", supervisor: "peter", startDate: "2022-07-05", ...usd(7200), retirementPct: 3, adpId: "ROP-1004" }],
    ["mina", { name: "Mina Sharifi", title: "HR Officer", office: "Afghanistan", employment: "National staff", supervisor: "sima", startDate: "2023-11-01", ...afn(56000), bankAccount: "AIB 0000-4101 (sample)" }],
    ["karim", { name: "Karim Ahmadi", title: "Country Director", office: "Afghanistan", employment: "National staff", supervisor: "grace", startDate: "2020-04-01", ...afn(245000), dangerPay: 0, commsAllowance: 3500, bankAccount: "AIB 0000-4102 (sample)" }],
    ["nadia", { name: "Nadia Rahimi", title: "Project Manager", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-02-15", ...afn(98000), commsAllowance: 2000, phone: "+93 70 000 0101", bankAccount: "AIB 0000-4103 (sample)" }],
    ["yusuf", { name: "Yusuf Mohammadi", title: "Finance Officer", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-05-01", ...afn(70000), bankAccount: "AIB 0000-4104 (sample)" }],
    ["zahra", { name: "Zahra Karimi", title: "Procurement Officer", office: "Afghanistan", employment: "National staff", supervisor: "hamid", startDate: "2024-03-01", ...afn(63000), bankAccount: "AIB 0000-4105 (sample)" }],
    ["hamid", { name: "Hamid Wardak", title: "Procurement Manager", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2022-09-01", ...afn(84000), bankAccount: "AIB 0000-4106 (sample)" }],
    ["farid", { name: "Farid Sultani", title: "Horticulture Specialist", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2024-01-15", contractEnd: "2027-12-31", ...afn(77000), bankAccount: "AIB 0000-4107 (sample)", dangerPay: 35 }],
    ["javed", { name: "Javed Mansoor", title: "Sr. Civil Engineer", office: "Afghanistan", employment: "National staff", supervisor: "karim", startDate: "2023-08-01", contractEnd: "2027-12-31", ...afn(91000), bankAccount: "AIB 0000-4108 (sample)", dangerPay: 35 }],
    ["bilal", { name: "Bilal Haidari", title: "Storekeeper", office: "Afghanistan", employment: "National staff", supervisor: "nadia", startDate: "2024-06-01", ...afn(35000), bankAccount: "AIB 0000-4109 (sample)" }],
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

  // Last month's timesheets.
  const [y, m] = today.split("-").map(Number);
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const sheet = (office: string, shares: Record<string, number>, edit?: (s: Sheet) => void) => {
    const s0 = prefill(last, office, shares);
    edit?.(s0);
    return s0;
  };
  const workdays = (s0: Sheet) => Object.keys(s0.days).filter((d) => s0.days[d].hours);
  const nadia = await write("nadia", "timesheet", "nadia", sheet("Afghanistan", { "ACRP-2026": 3, "A-2027": 1 }, (s0) => {
    for (const d of workdays(s0).slice(8, 10)) s0.days[d] = { leave: { type: "vacation", hours: 8 } };
  }));
  await write("karim", "ts-approve", "nadia", { timesheet: nadia });
  const sima = await write("sima", "timesheet", "sima", sheet("Home Office", { "non-contract": 7, "ACRP-2026": 3 }));
  await write("peter", "ts-approve", "sima", { timesheet: sima });
  await write("farid", "timesheet", "farid", sheet("Afghanistan", { "ACRP-2026": 1 }, (s0) => {
    for (const d of workdays(s0).slice(3, 8)) s0.days[d] = { ...s0.days[d], allowances: ["dangerPay"], note: "Field work, Kandahar" };
  }));
  // Bilal has no phone: HR enters his timesheet from the paper form.
  await write("mina", "timesheet", "bilal", sheet("Afghanistan", { "A-2027": 1 }, (s0) => {
    const d = workdays(s0)[12];
    if (d) s0.days[d] = { leave: { type: "sick", hours: 8 } };
  }));
  // Everyone else's October, approved by their supervisor (HR for the CEO, who has none).
  const approvedSheets: [string, string, string, Record<string, number>][] = [
    ["grace", "sima", "Home Office", { "non-contract": 8, "ACRP-2026": 2 }],
    ["peter", "grace", "Home Office", { "non-contract": 9, "ACRP-2026": 1 }],
    ["omid", "peter", "Home Office", { "non-contract": 1 }],
    ["mina", "sima", "Afghanistan", { "non-contract": 1, "ACRP-2026": 1 }],
    ["karim", "grace", "Afghanistan", { "ACRP-2026": 3, "A-2027": 1, "non-contract": 1 }],
    ["yusuf", "karim", "Afghanistan", { "ACRP-2026": 1, "non-contract": 1 }],
    ["hamid", "karim", "Afghanistan", { "ACRP-2026": 1 }],
    ["zahra", "hamid", "Afghanistan", { "ACRP-2026": 2, "A-2027": 1 }],
  ];
  for (const [who, approver, office, shares] of approvedSheets) {
    const t = await write(who, "timesheet", who, sheet(office, shares));
    await write(approver, "ts-approve", who, { timesheet: t });
  }
  const javed = await write("javed", "timesheet", "javed", sheet("Afghanistan", { "ACRP-2026": 1 }));
  await write("karim", "ts-return", "javed", { timesheet: javed, note: "The two days in Herat need the field-trip note and danger pay marked." });

  // Expense reports. Sima's trip matches the per diem form in the payroll package: 94 a day, 75% on travel days.
  const taxi = await file("airport-shuttle.pdf", "Sample receipt: airport shuttle, 29.00 USD", "sima");
  const simaEx = await write("sima", "expense", "sima", {
    month: last,
    currency: "USD",
    lines: [
      { date: `${last}-14`, category: "perDiem", description: "Programme visit, Western Highlands", source: "non-contract", perDiem: { place: "Guatemala City", rate: 94, start: `${last}-14`, end: `${last}-22` }, receipts: [] },
      { date: `${last}-13`, category: "taxi", description: "Airport shuttle", source: "non-contract", amount: 29, receipts: [taxi] },
      { date: `${last}-28`, category: "parking", description: "Ferry parking, donor meeting", source: "non-contract", amount: 4, receipts: [], noReceipt: "Pay-and-display machine, no receipt" },
    ],
  });
  await write("peter", "ex-approve", "sima", { report: simaEx });
  await write("omid", "ex-approve", "sima", { report: simaEx });
  const fuel = await file("taxi-herat.pdf", "Sample receipt: taxi Herat, 1500 AFN", "nadia");
  // Policies new hires read (sample documents, to be replaced by ROP's own).
  for (const [id, title] of [
    ["code-of-conduct", "Code of Conduct"],
    ["safeguarding", "Safeguarding and PSEA"],
    ["anti-fraud", "Anti-fraud and anti-corruption"],
    ["security", "Security plan, Afghanistan"],
  ] as const)
    await write("sima", "policy", null, { id, title, version: "2026-01", file: await file(`${id}.pdf`, `Sample policy: ${title}. Replace with ROP's document.`, "sima") });

  // A new hire who started this week, part way through onboarding.
  const zStart = addDays(today, -3);
  const zHire = await propose("sima", {
    type: "hire",
    subject: "zarlasht",
    effective: zStart,
    fields: { name: "Zarlasht Noori", title: "M&E Assistant", office: "Afghanistan", employment: "National staff", supervisor: "nadia", startDate: zStart, contractEnd: "2027-12-31", ...afn(52000) },
    reason: "New post in the ACRP staffing plan, recruited in October.",
  });
  await approve("peter", zHire, 0, "cfo", "zarlasht");
  await approve("grace", zHire, 1, "ceo", "zarlasht");
  const contract = await file("contract-zarlasht-noori.pdf", "Sample employment contract: Zarlasht Noori, M&E Assistant", "sima");
  await write("sima", "onboard-start", "zarlasht", { due: addDays(today, 11), contract });
  await write("mina", "onboard-step", "zarlasht", { step: "it", value: { kind: "confirm", note: "Email zarlasht.noori@ created; laptop RP-114 issued." } });

  // Leave: one approved, one waiting, a sick claim without a certificate, a new hire in probation.
  const nextWeek = addDays(today, 7);
  const nadiaLeave = await write("nadia", "leave", "nadia", { kind: "vacation", start: addDays(today, 20), end: addDays(today, 24), note: "Family wedding in Mazar." });
  await write("karim", "lv-approve", "nadia", { request: nadiaLeave });
  await write("farid", "leave", "farid", { kind: "vacation", start: nextWeek, end: addDays(nextWeek, 3), note: "Visiting family in Herat." });
  await write("bilal", "leave", "bilal", { kind: "sick", start: addDays(today, -6), end: addDays(today, -1) });
  await write("zarlasht", "leave", "zarlasht", { kind: "vacation", start: addDays(today, 10), end: addDays(today, 11) });

  await write("nadia", "expense", "nadia", {
    month: last,
    currency: "AFN",
    lines: [{ date: `${last}-08`, category: "taxi", description: "Taxi to farmer group meeting, Herat", source: "ACRP-2026", amount: 1500, receipts: [fuel] }],
  });
}

/** Whether a person holds a role type in the authority table (server side). */
export async function holdsRole(person: string, type: import("@/lib/hr").HrRole) {
  const { state } = await loadHr();
  return !!state.rules?.holders[type]?.includes(person);
}
