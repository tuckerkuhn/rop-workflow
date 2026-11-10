import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { z } from "zod";
import { DEPARTMENTS, PARAMS, ROP, paramByKey, show, type Value } from "@/lib/policy";
import { PROFILES, compareProfile, fits, keepsToPolicy, profileById } from "@/lib/presets";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadOrgSettings, orgIdForPerson, saveOrgSettings, withSettings, type OrgChange, type OrgSettings } from "@/server/org-settings-store";

/**
 * The organization's own rules, by department. The written policy is the floor: everyone signed
 * in can read the rules; only an administrator adds to them, either a stricter standard of their
 * own or the gaps a requirement profile shows, always with a reason, and every change is kept.
 */

function view(settings: OrgSettings, admin: boolean) {
  const profile = withSettings(settings);
  const current = Object.fromEntries(Object.entries(profile.values).map(([k, c]) => [k, c.value])) as Record<string, Value>;
  return {
    name: ROP.name,
    departments: DEPARTMENTS,
    params: PARAMS,
    /** The written policy's value and source for each rule. */
    policy: ROP.values,
    /** The value in force for each rule, with its source. */
    current: profile.values,
    changed: settings.values,
    history: [...settings.history].reverse(),
    /** Solo mode (server/solo.ts): who turned it on or off, when and why. */
    solo: settings.solo ?? null,
    soloHistory: [...(settings.soloHistory ?? [])].reverse(),
    profiles: PROFILES.map((p) => ({ id: p.id, name: p.name, summary: p.summary, comparison: compareProfile(p, current) })),
    admin,
  };
}
export type OrgSettingsView = ReturnType<typeof view>;

async function orgOf(personId: string) {
  const id = await orgIdForPerson(personId);
  if (!id) throw new Error("No organization is set up yet.");
  return id;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(view(await loadOrgSettings(await orgOf(v.user.id)), !!v.user.admin));
  });
}

const value = z.union([z.number().finite(), z.boolean(), z.string().max(300), z.array(z.string().max(200)).max(40), z.null()]);
const reason = z.string().trim().min(5, "Say why, in a sentence: it is kept with the change.").max(1000);
const bodySchema = z.discriminatedUnion("action", [
  /** Layer a profile's gaps on top of the procedures. */
  z.object({ action: z.literal("layer"), profile: z.string().max(40), keys: z.array(z.string()).min(1).max(PARAMS.length), reason }),
  /** An administrator's own stricter standards, or facts brought up to date. */
  z.object({ action: z.literal("set"), changes: z.array(z.object({ key: z.string(), value })).min(1).max(PARAMS.length), reason }),
  /** Back to the written policy. */
  z.object({ action: z.literal("reset"), keys: z.array(z.string()).min(1).max(PARAMS.length), reason }),
  /** Solo mode for a small team: one person may prepare and approve, confirming it each time. */
  z.object({ action: z.literal("solo"), on: z.boolean(), reason }),
]);

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    if (!v.user.admin) return NextResponse.json({ error: "Only an administrator changes the organization's rules." }, { status: 403 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const orgId = await orgOf(v.user.id);
    const settings = await loadOrgSettings(orgId);
    const current = Object.fromEntries(Object.entries(withSettings(settings).values).map(([k, c]) => [k, c.value])) as Record<string, Value>;
    // Real dates: these are records of decisions, not demo data.
    const at = new Date().toISOString().slice(0, 10);
    const who = { by: v.user.id, name: v.user.name, at, reason: a.reason };
    const fail = (error: string) => NextResponse.json({ error }, { status: 400 });

    if (a.action === "solo") {
      if (!!settings.solo?.on === a.on) return fail(a.on ? "Solo mode is already on." : "Solo mode is already off.");
      const change = { on: a.on, ...who };
      const next: OrgSettings = { ...settings, solo: change, soloHistory: [...(settings.soloHistory ?? []), change] };
      await saveOrgSettings(orgId, next);
      await db.insert(schema.auditLog).values({ projectId: null, entity: "org_settings", entityId: orgId, action: a.on ? "solo_mode_on" : "solo_mode_off", detail: { by: v.user.id, reason: a.reason } });
      return NextResponse.json(view(next, true));
    }

    let made: OrgChange[] = [];
    if (a.action === "layer") {
      const p = profileById(a.profile);
      if (!p) return fail("No such profile.");
      // The gaps are worked out here, from the rules in force, not taken from the page.
      const gaps = new Map(compareProfile(p, current).filter((c) => c.status === "gap").map((c) => [c.key, c]));
      const bad = a.keys.filter((k) => !gaps.has(k));
      if (bad.length) return fail(`Not an open gap: ${bad.map((k) => paramByKey[k]?.label ?? k).join(", ")}.`);
      made = a.keys.map((k) => ({ key: k, value: gaps.get(k)!.result, ...who, preset: p.id }));
    } else if (a.action === "set") {
      for (const c of a.changes) {
        const def = paramByKey[c.key];
        if (!def) return fail(`No such rule: ${c.key}.`);
        if (!fits(def, c.value as Value)) return fail(`${def.label}: that value does not fit this rule.`);
        const written = ROP.values[c.key]?.value ?? null;
        if (!keepsToPolicy(def, c.value as Value, written)) return fail(`${def.label}: ${show(def, c.value as Value)} is looser than our written policy (${show(def, written)}). Our policy always applies; a change can only add to it.`);
      }
      made = a.changes.map((c) => ({ key: c.key, value: c.value as Value, ...who }));
    } else {
      for (const k of a.keys) if (!paramByKey[k]) return fail(`No such rule: ${k}.`);
      made = a.keys.map((k) => ({ key: k, value: ROP.values[k]?.value ?? null, ...who, reset: true }));
    }

    const values = { ...settings.values };
    for (const c of made) {
      const written = ROP.values[c.key]?.value ?? null;
      if (c.reset || JSON.stringify(c.value) === JSON.stringify(written)) {
        delete values[c.key];
        c.reset = true;
      } else values[c.key] = c;
    }
    const next: OrgSettings = { ...settings, values, history: [...settings.history, ...made] };
    await saveOrgSettings(orgId, next);
    await db.insert(schema.auditLog).values({ projectId: null, entity: "org_settings", entityId: orgId, action: `rules_${a.action}`, detail: { by: v.user.id, reason: a.reason, rules: made.map((c) => c.key) } });
    return NextResponse.json(view(next, true));
  });
}
