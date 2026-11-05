import { z } from "zod";
import type { Entry, HrState } from "@/lib/hr";
import { receiptSchema, type Receipt } from "@/lib/expense";

/**
 * Onboarding: the new hire's first-weeks checklist, done mostly by the new hire on their phone.
 * HR starts it with the contract; the new hire gives their details, reads and acknowledges each
 * policy, signs the contract and uploads their ID; HR and the supervisor tick off their parts.
 * Every step is an entry in the HR ledger, and each acknowledgement or signature names the exact
 * file (by fingerprint) that was read, so a policy or contract changed later cannot be passed off
 * as the one agreed to. Details go into the record only through the usual approvals.
 */

export type Owner = "self" | "hr" | "supervisor";
export type StepKind = "details" | "acknowledge" | "sign" | "upload" | "confirm" | "record";
export type StepDef = { id: string; title: string; help: string; owner: Owner; kind: StepKind; policy?: string };

/** The fixed steps. One "acknowledge" step is added per published policy. */
export const STEPS: StepDef[] = [
  { id: "details", title: "Your contact and bank details", help: "Phone, an emergency contact, and the bank account your salary goes to.", owner: "self", kind: "details" },
  { id: "contract", title: "Sign your contract", help: "Read your contract and sign it by typing your full name.", owner: "self", kind: "sign" },
  { id: "id", title: "Upload your ID", help: "A photo of your tazkira or passport, kept in your HR record and seen only by HR.", owner: "self", kind: "upload" },
  { id: "record", title: "Add the details to the HR record", help: "HR proposes the new hire's details; the bank account goes to the CFO and the CEO like any pay change.", owner: "hr", kind: "record" },
  { id: "it", title: "Email account and equipment", help: "HR confirms with IT that the email account is set up and equipment is issued.", owner: "hr", kind: "confirm" },
  { id: "security", title: "Security briefing", help: "The supervisor confirms the security briefing for the duty station was given.", owner: "supervisor", kind: "confirm" },
  { id: "induction", title: "Project induction", help: "The supervisor confirms the induction: the project, the team, the workplan and how timesheets and expenses work.", owner: "supervisor", kind: "confirm" },
];

export const OWNER_LABEL: Record<Owner, string> = { self: "You", hr: "HR", supervisor: "Your supervisor" };

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const policySchema = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/), title: z.string().trim().min(3).max(120), file: receiptSchema, version: z.string().trim().min(1).max(40) });
export type Policy = z.infer<typeof policySchema> & { n: number; at: string; by: string };

export const startSchema = z.object({ due: iso, contract: receiptSchema });
export const detailsSchema = z.object({
  phone: z.string().trim().min(6).max(40),
  emergencyContact: z.string().trim().min(6).max(200),
  bankAccount: z.string().trim().min(6).max(120),
});
const stepValue = z.union([
  z.object({ kind: z.literal("details"), details: detailsSchema }),
  z.object({ kind: z.literal("acknowledge"), file: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ kind: z.literal("sign"), file: z.string().regex(/^[0-9a-f]{64}$/), typedName: z.string().trim().min(3).max(200) }),
  z.object({ kind: z.literal("upload"), file: receiptSchema }),
  z.object({ kind: z.literal("confirm"), note: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("record"), proposals: z.array(z.number().int().positive()).max(5) }),
]);
export const stepSchema = z.object({ step: z.string().regex(/^[a-z0-9:-]{2,60}$/), value: stepValue });
export type StepValue = z.infer<typeof stepValue>;

export const obActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), person: z.string().regex(/^[a-z0-9-]{2,40}$/), due: iso, contract: receiptSchema }),
  z.object({ action: z.literal("step"), person: z.string().regex(/^[a-z0-9-]{2,40}$/), step: z.string().regex(/^[a-z0-9:-]{2,60}$/), value: stepValue }),
  z.object({ action: z.literal("policy"), id: z.string().regex(/^[a-z0-9-]{2,40}$/), title: z.string().trim().min(3).max(120), version: z.string().trim().min(1).max(40), file: receiptSchema }),
]);
export type ObAction = z.infer<typeof obActionSchema>;

/* ---------------- Folding ---------------- */

export type Done = { by: string; at: string; n: number; value: StepValue };
export type Onboarding = {
  person: string;
  startedBy: string;
  at: string;
  due: string;
  contract: Receipt;
  /** Policies in force when onboarding started: the ones to acknowledge. */
  policies: Policy[];
  done: Record<string, Done>;
};
export type ObIgnored = { n: number; kind: string; actor: string; why: string };

/** Every step for this person, fixed steps first and one per policy. */
export function stepsFor(o: Pick<Onboarding, "policies">): StepDef[] {
  const [details, contract, ...rest] = STEPS;
  return [
    details,
    ...o.policies.map((p) => ({ id: `policy:${p.id}`, title: `Read: ${p.title}`, help: `Version ${p.version}. Read it and confirm you will follow it.`, owner: "self" as Owner, kind: "acknowledge" as StepKind, policy: p.id })),
    contract,
    ...rest,
  ];
}
export const progress = (o: Onboarding) => {
  const steps = stepsFor(o);
  return { done: steps.filter((s) => o.done[s.id]).length, total: steps.length };
};

/** Who may complete a step for this person. */
export function mayDo(u: string, owner: Owner, person: string, hr: HrState): boolean {
  if (owner === "self") return u === person;
  if (owner === "hr") return u !== person && !!hr.rules?.holders.hr.includes(u);
  return u !== person && hr.people[person]?.current.supervisor === u;
}

export function foldOnboarding(entries: Entry[], hr: HrState): { onboarding: Onboarding[]; policies: Policy[]; ignored: ObIgnored[] } {
  const policies = new Map<string, Policy>();
  const byPerson = new Map<string, Onboarding>();
  const ignored: ObIgnored[] = [];
  const isHr = (u: string) => !!hr.rules?.holders.hr.includes(u);
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind === "policy") {
      const d = policySchema.safeParse(e.data);
      if (!d.success || !isHr(e.actor)) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: d.success ? "only HR publishes policies" : "unreadable" });
      else policies.set(d.data.id, { ...d.data, n: e.n, at: e.at, by: e.actor });
    } else if (e.kind === "onboard-start") {
      const d = startSchema.safeParse(e.data);
      if (!d.success || !e.subject) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
      else if (!isHr(e.actor) || e.actor === e.subject) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only HR starts someone else's onboarding" });
      else if (!hr.people[e.subject]) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "no HR record for this person" });
      else if (byPerson.has(e.subject)) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "onboarding already started" });
      else byPerson.set(e.subject, { person: e.subject, startedBy: e.actor, at: e.at, due: d.data.due, contract: d.data.contract, policies: [...policies.values()], done: {} });
    } else if (e.kind === "onboard-step") {
      const d = stepSchema.safeParse(e.data);
      const o = e.subject ? byPerson.get(e.subject) : undefined;
      if (!d.success || !o) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "no onboarding for this person" });
        continue;
      }
      const def = stepsFor(o).find((s) => s.id === d.data.step);
      if (!def || def.kind !== d.data.value.kind) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not a step of this onboarding" });
        continue;
      }
      if (!mayDo(e.actor, def.owner, o.person, hr)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not the person who does this step" });
        continue;
      }
      if (o.done[def.id]) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "already done" });
        continue;
      }
      const v = d.data.value;
      // An acknowledgement or a signature must name the very file that was given.
      if (v.kind === "acknowledge" && o.policies.find((p) => p.id === def.policy)?.file.hash !== v.file) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "acknowledges a different version of the policy" });
        continue;
      }
      if (v.kind === "sign") {
        const name = String(hr.people[o.person]?.current.name ?? "").trim().toLowerCase();
        if (v.file !== o.contract.hash) {
          ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "signs a different contract" });
          continue;
        }
        if (v.typedName.trim().toLowerCase() !== name) {
          ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "the typed name does not match the record" });
          continue;
        }
      }
      if (def.kind === "record" && !o.done.details) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "the new hire has not given their details yet" });
        continue;
      }
      o.done[def.id] = { by: e.actor, at: e.at, n: e.n, value: v };
    }
  }
  return { onboarding: [...byPerson.values()], policies: [...policies.values()], ignored };
}
