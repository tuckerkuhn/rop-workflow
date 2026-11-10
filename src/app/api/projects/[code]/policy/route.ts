import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { DONORS, donorById } from "@/lib/donors";
import { PARAMS, effective, paramByKey, type Profile } from "@/lib/policy";
import { requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { donorOf, loadPolicy, savePolicy, type PolicySetting } from "@/server/policy-store";
import { orgProfile } from "@/server/org-settings-store";
import { projectByCode } from "@/server/field-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project's organization's rules, with the changes made in Settings. */
const orgOf = async (code: string) => orgProfile((await projectByCode(code)).organizationId);

/**
 * The rules a project follows: the organization's policy combined with its donor's. Project
 * managers choose the donor profile (or enter a custom one); only an administrator decides a
 * conflict, and every decision is kept.
 */

function view(setting: PolicySetting, org: Profile) {
  const donor = donorOf(setting);
  const eff = effective(org, donor, setting.decisions, setting.approvals);
  return {
    setting,
    org: { id: org.id, name: org.name, summary: org.summary, documents: org.documents },
    donor: donor ? { id: donor.id, name: donor.name, summary: donor.summary, documents: donor.documents } : null,
    donors: DONORS.map((d) => ({ id: d.id, name: d.name, summary: d.summary })),
    params: PARAMS,
    lines: eff.lines,
    open: eff.open.map((l) => l.key),
    gaps: eff.gaps.map((l) => l.key),
  };
}
export type PolicyView = ReturnType<typeof view>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(view(await loadPolicy(code), await orgOf(code)));
  });
}

const cited = z.object({ value: z.union([z.number().finite(), z.boolean(), z.string().max(300), z.array(z.string().max(200)).max(40), z.null()]), source: z.string().trim().max(300), confidence: z.enum(["documented", "restated", "to verify"]).optional() });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choose"), donor: z.string().max(40).nullable() }),
  z.object({ action: z.literal("custom"), name: z.string().trim().min(2).max(120), values: z.record(z.string(), cited) }),
  z.object({ action: z.literal("decide"), key: z.string(), value: cited.shape.value, reason: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("approve"), keys: z.array(z.string()).min(1).max(PARAMS.length), reason: z.string().trim().min(5, "Say why, in a sentence: it is kept with the approval.").max(1000) }),
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
    const org = await orgOf(code);
    // Real dates: these are records of decisions, not demo data.
    const at = new Date().toISOString().slice(0, 10);
    if (a.action === "decide") {
      // A conflict between policies is escalated: only an administrator decides it, with a reason kept forever.
      if (!u.admin) return NextResponse.json({ error: "Only an administrator decides a conflict between the organization's and the donor's rules." }, { status: 403 });
      if (!paramByKey[a.key]) return NextResponse.json({ error: "No such rule." }, { status: 400 });
      const decision = { value: a.value, by: u.id, name: u.name, at, reason: a.reason };
      const next = { ...setting, decisions: { ...setting.decisions, [a.key]: decision }, history: [...setting.history, { ...decision, key: a.key }] };
      await savePolicy(code, next);
      await audit(code, { entity: "policy", entityId: crypto.randomUUID(), action: "policy_conflict_decided", by: u.id, detail: { key: a.key, value: a.value, reason: a.reason } });
      return NextResponse.json(view(next, org));
    }
    if (!canEditProject(u) && !u.admin) return NextResponse.json({ error: "The project manager or an administrator chooses the donor's rules." }, { status: 403 });
    if (a.action === "approve") {
      // Only real gaps: a donor requirement stricter than the organization's procedures, not yet layered on.
      const gaps = new Set(effective(org, donorOf(setting), setting.decisions, setting.approvals).gaps.map((l) => l.key));
      const bad = a.keys.filter((k) => !gaps.has(k));
      if (bad.length) return NextResponse.json({ error: `Not an open gap: ${bad.join(", ")}.` }, { status: 400 });
      const approval = { by: u.id, name: u.name, at, reason: a.reason };
      const approvals = { ...(setting.approvals ?? {}), ...Object.fromEntries(a.keys.map((k) => [k, approval])) };
      const next: PolicySetting = { ...setting, approvals, history: [...setting.history, ...a.keys.map((k) => ({ ...approval, key: k, value: null, layered: true }))] };
      await savePolicy(code, next);
      await audit(code, { entity: "policy", entityId: crypto.randomUUID(), action: "policy_donor_rules_layered", by: u.id, detail: { keys: a.keys, reason: a.reason } });
      return NextResponse.json(view(next, org));
    }
    if (a.action === "choose") {
      if (a.donor && a.donor !== "custom" && !donorById(a.donor)) return NextResponse.json({ error: "No such donor profile." }, { status: 400 });
      // A different donor makes earlier decisions moot; they stay in the history.
      // A different donor makes earlier decisions and approvals moot; they stay in the history.
      const same = a.donor === setting.donor;
      const next: PolicySetting = { ...setting, donor: a.donor, decisions: same ? setting.decisions : {}, approvals: same ? setting.approvals : {}, chosenBy: { by: u.id, name: u.name, at } };
      await savePolicy(code, next);
      // Earlier decisions and approvals fall away with a different donor: the trail keeps what they were.
      await audit(code, { entity: "policy", entityId: crypto.randomUUID(), action: "policy_donor_chosen", by: u.id, detail: { donor: a.donor, was: setting.donor ?? null, ...(same ? {} : { decisionsCleared: Object.keys(setting.decisions ?? {}), approvalsCleared: Object.keys(setting.approvals ?? {}) }) } });
      return NextResponse.json(view(next, org));
    }
    const values = Object.fromEntries(Object.entries(a.values).filter(([k]) => paramByKey[k]));
    const next: PolicySetting = { ...setting, donor: "custom", custom: { name: a.name, values }, decisions: setting.donor === "custom" ? setting.decisions : {}, approvals: setting.donor === "custom" ? setting.approvals : {}, chosenBy: { by: u.id, name: u.name, at } };
    await savePolicy(code, next);
    await audit(code, { entity: "policy", entityId: crypto.randomUUID(), action: "policy_custom_donor_saved", by: u.id, detail: { name: a.name, values: Object.fromEntries(Object.entries(values).map(([k, c]) => [k, c.value])), was: setting.donor ?? null } });
    return NextResponse.json(view(next, org));
  });
}
