import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { DONORS, donorById } from "@/lib/donors";
import { PARAMS, ROP, effective, paramByKey } from "@/lib/policy";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { donorOf, loadPolicy, savePolicy, type PolicySetting } from "@/server/policy-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The rules a project follows: the organization's policy combined with its donor's. Project
 * managers choose the donor profile (or enter a custom one); only an administrator decides a
 * conflict, and every decision is kept.
 */

function view(setting: PolicySetting) {
  const donor = donorOf(setting);
  const eff = effective(ROP, donor, setting.decisions);
  return {
    setting,
    org: { id: ROP.id, name: ROP.name, summary: ROP.summary, documents: ROP.documents },
    donor: donor ? { id: donor.id, name: donor.name, summary: donor.summary, documents: donor.documents } : null,
    donors: DONORS.map((d) => ({ id: d.id, name: d.name, summary: d.summary })),
    params: PARAMS,
    lines: eff.lines,
    open: eff.open.map((l) => l.key),
  };
}
export type PolicyView = ReturnType<typeof view>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(view(await loadPolicy(code)));
  });
}

const cited = z.object({ value: z.union([z.number().finite(), z.boolean(), z.string().max(300), z.array(z.string().max(200)).max(40), z.null()]), source: z.string().trim().max(300), confidence: z.enum(["documented", "restated", "to verify"]).optional() });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choose"), donor: z.string().max(40).nullable() }),
  z.object({ action: z.literal("custom"), name: z.string().trim().min(2).max(120), values: z.record(z.string(), cited) }),
  z.object({ action: z.literal("decide"), key: z.string(), value: cited.shape.value, reason: z.string().trim().min(5).max(1000) }),
]);

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const u = v.user;
    const setting = await loadPolicy(code);
    // Real dates: these are records of decisions, not demo data.
    const at = new Date().toISOString().slice(0, 10);
    if (a.action === "decide") {
      // A conflict between policies is escalated: only an administrator decides it, with a reason kept forever.
      if (!u.admin) return NextResponse.json({ error: "Only an administrator decides a conflict between the organization's and the donor's rules." }, { status: 403 });
      if (!paramByKey[a.key]) return NextResponse.json({ error: "No such rule." }, { status: 400 });
      const decision = { value: a.value, by: u.id, name: u.name, at, reason: a.reason };
      const next = { ...setting, decisions: { ...setting.decisions, [a.key]: decision }, history: [...setting.history, { ...decision, key: a.key }] };
      await savePolicy(code, next);
      return NextResponse.json(view(next));
    }
    if (!canEditProject(u) && !u.admin) return NextResponse.json({ error: "The project manager or an administrator chooses the donor's rules." }, { status: 403 });
    if (a.action === "choose") {
      if (a.donor && a.donor !== "custom" && !donorById(a.donor)) return NextResponse.json({ error: "No such donor profile." }, { status: 400 });
      // A different donor makes earlier decisions moot; they stay in the history.
      const next: PolicySetting = { ...setting, donor: a.donor, decisions: a.donor === setting.donor ? setting.decisions : {}, chosenBy: { by: u.id, name: u.name, at } };
      await savePolicy(code, next);
      return NextResponse.json(view(next));
    }
    const values = Object.fromEntries(Object.entries(a.values).filter(([k]) => paramByKey[k]));
    const next: PolicySetting = { ...setting, donor: "custom", custom: { name: a.name, values }, decisions: setting.donor === "custom" ? setting.decisions : {}, chosenBy: { by: u.id, name: u.name, at } };
    await savePolicy(code, next);
    return NextResponse.json(view(next));
  });
}
