import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FIELD_KEYS, mayPropose, type FieldKey, type Fields, type ProposalInput } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, loadHr, todayIso } from "@/server/hr-store";

/**
 * Moves people from BambooHR into the HR record: one "new person" proposal each, through the usual
 * approvals. Supervisors are matched by name, first among the people in the file, then among
 * records already in the HR book. People already in the book (same name) are skipped.
 */
const value = z.union([z.string().trim().max(300), z.number().finite().min(0).max(1e9), z.null()]);
const body = z.object({
  file: z.string().trim().min(1).max(200),
  rows: z
    .array(z.object({ fields: z.partialRecord(z.enum(FIELD_KEYS as [FieldKey, ...FieldKey[]]), value), reportsTo: z.string().trim().max(200) }))
    .min(1)
    .max(300),
});
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
const slug = (name: string) => `${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "person"}-${randomBytes(2).toString("hex")}`;

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That import is not complete." }, { status: 400 });
    const me = v.user.id;
    const { state } = await loadHr();
    const existing = new Map(Object.values(state.people).map((p) => [norm(String(p.current.name ?? "")), p.id]));
    const rows = parsed.data.rows.map((r) => ({ ...r, id: slug(String(r.fields.name ?? "")) }));
    const inFile = new Map(rows.map((r) => [norm(String(r.fields.name ?? "")), r.id]));
    const reason = `Moved from BambooHR (${parsed.data.file}).`;
    const effective = todayIso();
    const made: { name: string; proposal: number }[] = [];
    const skipped: { name: string; why: string }[] = [];
    // Supervisors first, so a supervisor's record is proposed before their team's.
    const supervisors = new Set(rows.map((r) => norm(r.reportsTo)));
    rows.sort((a, b) => Number(supervisors.has(norm(String(b.fields.name ?? "")))) - Number(supervisors.has(norm(String(a.fields.name ?? "")))));
    for (const r of rows) {
      const name = String(r.fields.name ?? "");
      if (existing.has(norm(name))) {
        skipped.push({ name, why: "already in the HR record" });
        continue;
      }
      const sup = r.reportsTo ? (inFile.get(norm(r.reportsTo)) ?? existing.get(norm(r.reportsTo)) ?? null) : null;
      const fields: Fields = { ...r.fields, ...(sup ? { supervisor: sup } : {}) };
      const p: ProposalInput = { type: "hire", subject: r.id, effective, fields, reason: r.reportsTo && !sup ? `${reason} Supervisor "${r.reportsTo}" not found: set it after approval.` : reason };
      const why = mayPropose(me, p, state);
      if (why) {
        if (!made.length) return NextResponse.json({ error: why }, { status: 403 });
        skipped.push({ name, why });
        continue;
      }
      made.push({ name, proposal: await append(me, "propose", r.id, p) });
    }
    return NextResponse.json({ made, skipped });
  });
}
