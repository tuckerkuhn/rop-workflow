import { NextResponse } from "next/server";
import { isSharePointUrl } from "@/lib/procurement";
import { counts, decisionsSchema, guessMapping, mappingSchema, matchGroups, readRows, signatureOf, toBva, type Decisions, type SavedMapping } from "@/lib/spend-map";
import { requireViewer } from "@/server/auth";
import { fingerprint, loadActuals, mayImport, saveActuals } from "@/server/actuals-store";
import { handle } from "@/server/guard";
import { budgetRefs, loadSpendMapping, pickSheet, proposeMapping, readSpendFile, rememberedFor, saveSpendMapping } from "@/server/spend-map-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Spending from any spreadsheet (B3), when the file is not Finance's ICE workbook. The file is
 * sent with every step and read again; nothing from it is kept until the import.
 * - step=propose: the columns, remembered from last month when the headings match, otherwise
 *   proposed by the AI from the first rows (people's names removed);
 * - step=preview: the rows read with the confirmed columns and matched to budget lines;
 * - step=import: saved, with the columns and account choices remembered for next month.
 */

const MAX = 15 * 1024 * 1024;
const cell = (c: unknown) => (c == null ? "" : String(c).slice(0, 60));
const json = (v: unknown) => {
  try {
    return JSON.parse(String(v ?? "null"));
  } catch {
    return null;
  }
};

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (!(await mayImport(v.user))) return NextResponse.json({ error: "Only Finance and the people named for the NetSuite import can import spending." }, { status: 403 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the file." }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "That file is over 15 MB." }, { status: 400 });
    const name = file.name.slice(0, 200);
    if (!/\.(xlsx|csv)$/i.test(name)) return NextResponse.json({ error: "Use an Excel workbook (.xlsx) or a CSV file." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const sheets = await readSpendFile(buf, name);
    if (!sheets?.length) return NextResponse.json({ error: "The app could not read that file. Save it again as .xlsx or .csv." }, { status: 400 });
    const step = String(form?.get("step") ?? "propose");
    const saved = await loadSpendMapping(code);

    if (step === "propose") {
      const sheet = pickSheet(sheets, String(form?.get("sheet") ?? "") || null);
      if (!sheet) return NextResponse.json({ error: "That sheet is not in the file." }, { status: 400 });
      const base = { sheets: sheets.map((x) => x.name), sheet: sheet.name, rows: sheet.grid.slice(0, 30).map((r) => (r ?? []).slice(0, 40).map(cell)) };
      const remembered = rememberedFor(saved, sheet);
      if (remembered) return NextResponse.json({ ...base, mapping: remembered, remembered: true, reason: "" });
      try {
        const { mapping, reason } = await proposeMapping(code, sheet, name, v.user.id);
        return NextResponse.json({ ...base, mapping, remembered: false, reason, ai: true });
      } catch (e) {
        // No AI: the columns are guessed from their headings, and the person checks them all the same.
        return NextResponse.json({ ...base, mapping: guessMapping(sheet.grid, sheet.name), remembered: false, reason: "", ai: false, aiError: e instanceof Error ? e.message : String(e) });
      }
    }

    const m = mappingSchema.safeParse(json(form?.get("mapping")));
    if (!m.success) return NextResponse.json({ error: "Confirm the columns first." }, { status: 400 });
    const mapping = m.data;
    const sheet = pickSheet(sheets, mapping.sheet);
    if (!sheet) return NextResponse.json({ error: "That sheet is not in the file." }, { status: 400 });
    const d = decisionsSchema.safeParse(json(form?.get("decisions") ?? "{}"));
    const decisions: Decisions = d.success ? d.data : { confirmed: [], assign: {} };
    const { budget, currency } = await budgetRefs(code);
    if (!budget.length) return NextResponse.json({ error: "This project has no budget lines to match the spending to." }, { status: 400 });
    const read = readRows(sheet.grid, mapping, currency);
    const groups = matchGroups(read, budget, saved?.assign ?? {}, decisions);
    const confirmed = new Set(decisions.confirmed);
    const bva = toBva(read, groups, budget, confirmed, name);
    const preview = { headers: read.headers, months: read.months, monthLabels: bva.monthLabels, currency: read.currency, rows: read.rows, groups, problems: read.problems, notes: bva.notes, total: bva.totals.grand?.actual ?? 0, budget: budget.map((b) => ({ code: b.code, description: b.description })) };
    if (step === "preview") return NextResponse.json({ preview });
    if (step !== "import") return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    if (read.problems.length) return NextResponse.json({ preview, error: "The file has problems: see below." }, { status: 400 });

    const sharepointUrl = String(form?.get("sharepointUrl") ?? "").trim() || null;
    if (sharepointUrl && !isSharePointUrl(sharepointUrl)) return NextResponse.json({ error: "That is not a link to ROP's SharePoint." }, { status: 400 });
    // Remembered for next month: every account a person placed (assigned, left out, or a ticked description match).
    const assign = { ...(saved?.assign ?? {}) };
    for (const g of groups) {
      if (g.how === "assigned" || (g.how === "description" && confirmed.has(g.key))) assign[g.key] = g.line!;
      else if (g.how === "skipped") assign[g.key] = "skip";
      else if (decisions.assign[g.key] === "") delete assign[g.key];
    }
    const next: SavedMapping = { mapping, signature: signatureOf(read.headers), assign, by: v.user.id, at: new Date().toISOString() };
    const tally = (how: string) => groups.filter((g) => g.how === how).length;
    const out = await saveActuals(code, bva, { name, hash: fingerprint(buf), sharepointUrl }, v.user.id, {
      source: "spreadsheet",
      detail: { sheet: sheet.name, rows: read.rows, accounts: groups.length, byCode: tally("code"), byDescription: groups.filter((g) => g.how === "description" && counts(g, confirmed)).length, remembered: tally("remembered"), assigned: tally("assigned"), leftOut: tally("skipped"), unmatched: groups.filter((g) => g.how !== "skipped" && !counts(g, confirmed)).length },
      also: (tx, projectId) => saveSpendMapping(tx, projectId, saved, next, name),
    });
    return NextResponse.json({ preview, saved: true, ...out, ...(await loadActuals(code)), mayImport: true });
  });
}
