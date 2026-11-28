import { storeNames } from "@/lib/file-store";
import { isProcurementManager } from "@/lib/procurement-plan";
import { registerAuthority } from "@/lib/authority";
import { sameHistory } from "@/lib/history";
import { users, type AppUser } from "@/lib/demo";
import type { Value } from "@/lib/policy";
import { DONE, mayNameReceiver, receiverProblem, requesterOf, requesterPersonOf, soloBarred, setLineMoney, setProcurementSet, setSupplierRegister, maySign, nextStep, ownerOf, prevStep, procRolesFor, ready, roleLabel, setProcurementRules, stepById, type Procurement, type LineMoney, type Role, holdersFor, otherHolder, voucherBarred } from "@/lib/procurement";
import { closeInstalment } from "@/lib/payments";
import type { Authority } from "@/lib/authority";
import type { PlanItem } from "@/lib/procurement-plan";
import { loadHr } from "@/server/hr-store";
import { loadSuppliers } from "@/server/suppliers-store";
import type { Supplier } from "@/lib/suppliers";
import { projectRules } from "@/server/policy-store";
import { soloFor, type SoloState } from "@/server/solo";
import { loadBudget } from "@/server/plan-store";
import { lineMoneyOf, loadPlan } from "@/server/procurement-plan-store";
import { HttpError } from "@/server/guard";

/**
 * Server-side enforcement of the procurement workflow. The screen builds each change, but the
 * server decides whether it is allowed, using the same rules (the project's policy and the
 * organization's authority table) the screen uses:
 * - a new request starts at the first step, unsigned, made by a budget holder;
 * - a closed procurement does not change (documents and issues may still be added);
 * - the history and signatures are append-only, and a new signature is the signer's own, for a
 *   role they may sign on this procurement; the requester never approves their own request;
 * - the step moves only forward to the next step once it is complete, or back one step where the
 *   step allows it, and only by the person who owns the step; the second Finance check is someone
 *   else;
 * - a step's checks and the record's fields change only by that step's owner.
 * One rule broken refuses the whole save, with a plain-language reason.
 */

/** Everything the checks read, loaded first so they can then run without waiting on anything. */
export type ProcurementContext = { rules: Record<string, Value>; holders: Authority; register: Supplier[] | null; set: Procurement[]; solo: SoloState; /** The budget lines' live money, when the project has a budget (lib/line-money). */ lineMoney: LineMoney[] | null };
export async function loadProcurementContext(code: string, orgId: string | null | undefined, set: Procurement[]): Promise<ProcurementContext> {
  const [eff, hr, reg, solo] = await Promise.all([projectRules(code), loadHr().catch(() => null), code !== DEMO_PROJECT && orgId ? loadSuppliers(orgId) : Promise.resolve(null), code !== DEMO_PROJECT ? soloFor(code) : Promise.resolve({ on: false, blocked: null })]);
  // The budget and the calendar's open asks, for the one figure of what is left on a line. A project with no budget has none.
  // A budget that cannot be read stops the save, rather than letting the money checks pass unseen
  // (code review of ISS-07). The demo project keeps its sample lines.
  const lineMoney = await Promise.all([loadBudget(code), loadPlan(code)])
    .then(([budget, items]) => (budget.lines.length ? lineMoneyOf(budget, items) : null))
    .catch(() => {
      if (code === DEMO_PROJECT) return null;
      throw new HttpError(503, "The project's budget could not be read just now, so the money checks cannot run. Try again in a moment.");
    });
  // The authority table with today's delegates (R2-13): someone acting for a person away signs as they would.
  const delegated = hr ? await (await import("@/server/auth")).roleHolders().catch(() => hr.state.rules?.holders ?? {}) : {};
  // An undecided conflict leaves that rule at the organization's own value, as on screen.
  return { rules: Object.fromEntries(eff.lines.filter((l) => !l.conflict || l.decision).map((l) => [l.key, l.value as Value])), holders: delegated, register: reg?.suppliers ?? null, set, solo, lineMoney };
}
/**
 * Puts the context into the shared rules. The checks read module state, so call this immediately
 * before validating, with no await in between: another request cannot swap in its own project.
 */
export function applyProcurementContext(c: ProcurementContext) {
  setProcurementRules(c.rules);
  registerAuthority(c.holders);
  setSupplierRegister(c.register);
  setProcurementSet(c.set);
  setLineMoney(c.lineMoney);
  solo = c.solo;
}
let solo: SoloState = { on: false, blocked: null };

/** On a real project the supplier is a register record, copied as it stands there. */
function checkSupplier(prev: Procurement, next: Procurement, register: Supplier[]): string | null {
  if (same(prev.supplier, next.supplier) || !next.supplier) return null;
  const r = next.supplier.id ? register.find((x) => x.id === next.supplier!.id) : null;
  if (!r) return "Pick the supplier from the supplier register.";
  if (r.status === "suspended") return `${r.name} is suspended in the supplier register: ${r.suspendedWhy}`;
  if (next.supplier.name !== r.name || (next.supplier.licenceNo ?? "") !== r.licenceNo || (next.supplier.licenceExpiry ?? "") !== r.licenceExpiry) return "The supplier's name and licence come from the register, not typed in the procurement.";
  return null;
}

/** Compares by value with keys sorted: records come back from the database with their keys reordered. */
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));

/**
 * The steps at which each part of the record may change. A part not listed here may change at
 * any step, by that step's owner. Where the money comes from (plan, budget line, funding) never
 * changes after the request is made.
 */
const REQUISITION = ["need", "requisition"];
const FIELD_STEPS: Record<string, string[]> = {
  title: REQUISITION,
  qty: REQUISITION,
  unit: REQUISITION,
  unitPrice: REQUISITION,
  specification: REQUISITION,
  priceBasis: REQUISITION,
  esRisk: REQUISITION,
  neededBy: REQUISITION,
  place: REQUISITION,
  urgent: REQUISITION,
  activity: REQUISITION,
  feeds: REQUISITION,
  route: ["route"],
  evaluation: ["route", "solicitation", "rfq"],
  sole: ["route", "soleSource"],
  advertisedDays: ["rfq", "solicitation", "hoReview", "approveSol", "bids"],
  closingDate: ["rfq", "solicitation", "hoReview", "approveSol", "bids"],
  bids: ["quotes", "bids", "evaluateWaived", "evaluate"],
  selectedBid: ["quotes", "evaluateWaived", "evaluate"],
  committee: ["evaluate"],
  opening: ["bids"],
  supplier: ["quotes", "screen", "payForm"],
  contractCurrency: ["contract"],
  contractAfn: ["contract"],
  contractUsd: ["contract"],
  schedule: ["contract"],
  grn: ["receive"],
  invoice: ["payForm"],
  voucher: ["voucher", "voucherReview", "voucherApprove"],
  paid: ["paid"],
  plan: [],
  budgetLine: [],
  funding: [],
};
/** Parts of the record anyone with procurement access may add to at any stage. */
const FREE = new Set(["timeline", "links", "issues", "signatures", "checks", "step", "payments", "updatedAt", "distribution", "rev", "overrides", "receiver"]);

/**
 * Who receives and inspects the goods (ISS-12, decision D-27): the requester, or one person they
 * name in their own department; never procurement, never the storekeeper. Only the requester (or
 * an administrator, when the requester is away) names or withdraws them, while the goods are
 * being received and before the note is signed.
 */
function checkReceiver(prev: Procurement, next: Procurement, u: AppUser): string | null {
  if (same(prev.receiver, next.receiver)) return null;
  if (prev.step !== "receive") return "Someone else is named to receive the goods only while they are being received.";
  if ((prev.signatures["Goods received note"] ?? []).length) return "The goods received note is already signed.";
  // The same rule as the screen (lib/procurement mayNameReceiver): the requester, or an administrator.
  if (!mayNameReceiver(prev, u)) return `Only the person who requested the goods${requesterOf(prev) ? ` (${requesterOf(prev)})` : ""} names someone else to receive them.`;
  const r = next.receiver;
  if (!r) return null;
  const d = users.find((x) => x.id === r.id);
  if (!d) return "Choose someone on the organization's staff to receive the goods.";
  const why = receiverProblem(requesterPersonOf(prev), d);
  if (why) return why;
  if (r.name !== d.name || r.by !== u.name) return "The record of who was named is not complete: name them again.";
  return null;
}

/**
 * Distribution to participants: lists and checks are added, never changed, each in the name of
 * the person saving it; a check is by someone who recorded no list. Anyone with procurement
 * access may add them (field staff hand the goods out), from receipt until the procurement closes.
 */
function checkDistribution(prev: Procurement, next: Procurement, u: AppUser): string | null {
  const a = prev.distribution;
  const b = next.distribution;
  if (same(a, b)) return null;
  if (!b) return "Distribution records cannot be removed.";
  if (prev.step === DONE) return "This procurement is closed.";
  const before = { lists: a?.lists ?? [], checks: a?.checks ?? [] };
  if (b.lists.length < before.lists.length || !same(b.lists.slice(0, before.lists.length), before.lists)) return "A distribution list cannot be changed or removed once recorded.";
  if (b.checks.length < before.checks.length || !same(b.checks.slice(0, before.checks.length), before.checks)) return "A verification cannot be changed or removed once recorded.";
  if (a?.forParticipants && !b.forParticipants && before.lists.length) return "Distribution lists are recorded: it cannot be marked as not for participants.";
  if ((a?.inStock ?? 0) !== b.inStock && !procRolesFor(u).some((r) => r === "holder" || r === "procurement")) return "Only the budget holder or procurement records what is in stock.";
  for (const l of b.lists.slice(before.lists.length)) if (l.by !== u.id) return "A distribution list is recorded in your own name.";
  const distributors = new Set(b.lists.map((l) => l.by));
  for (const c of b.checks.slice(before.checks.length)) {
    if (c.by !== u.id) return "A verification is recorded in your own name.";
    if (distributors.has(u.id)) return "You recorded a distribution list: the verification must be by someone else.";
    if (c.confirmed > c.sampled) return "More confirmed than contacted.";
  }
  return null;
}

/** The demo project keeps its sample budget lines; every real project buys from its calendar. */
export const DEMO_PROJECT = "A-2027";

/**
 * On a real project a request charges an approved procurement calendar item, and carries that
 * item's budget line and the money left on it, not figures typed in the browser.
 */
function checkAgainstCalendar(next: Procurement, calendar: PlanItem[]): string | null {
  if (!next.plan) return "Start the request from an approved item on the procurement calendar, so it charges a real budget line.";
  const item = calendar.find((i) => i.key === next.plan!.key);
  if (!item) return `${next.plan.key} is not on this project's procurement calendar.`;
  if (item.status === "started" && item.procurementKey !== next.id) return `${item.key} already has a request: ${item.procurementKey}.`;
  if (item.status !== "approved" && item.status !== "started") return `${item.key} needs both approvals on the procurement calendar first.`;
  if ((item.budgetCode ?? "") !== next.plan.budgetCode || (item.budgetCode ?? "") !== next.budgetLine) return `The request must charge ${item.key}'s budget line ${item.budgetCode ?? "(none)"}.`;
  if (Math.abs(item.usd - next.plan.leftUsd) > 1 || item.value !== next.plan.left || item.currency !== next.plan.currency) return `The money left on ${item.key} is taken from the calendar, not changed in the request.`;
  // The demo's own award, not any project that calls itself fictional (the test bench does).
  if (/Award A-2027|demo award/i.test(next.funding) && next.plan?.project !== DEMO_PROJECT) return "The funding source names the demo award.";
  return null;
}

/** Null when allowed; otherwise why not. Rules must be prepared first (prepareProcurementRules). */
export function validateProcurementSave(prev: Procurement | undefined, next: Procurement, u: AppUser, calendar?: PlanItem[], register?: Supplier[] | null, others: Procurement[] = []): string | null {
  const roles = procRolesFor(u);
  if (!prev) {
    if (next.step !== "need") return "A new request starts at the first step.";
    if (Object.values(next.signatures ?? {}).some((l) => l.length)) return "A new request cannot carry signatures.";
    if (Object.values(next.checks ?? {}).some(Boolean)) return "A new request cannot have checks ticked.";
    if (!roles.includes("holder")) return "Only a budget holder can request a purchase.";
    if (calendar) {
      const why = checkAgainstCalendar(next, calendar);
      if (why) return why;
      // The request is the requester's own, so they cannot later approve it under another name.
      if ((next.plan?.requestedById && next.plan.requestedById !== u.id) || (next.plan?.requestedBy && next.plan.requestedBy !== u.name)) return "A request is made in your own name.";
      // One request per calendar item, counting requests saved alongside this one.
      if (others.some((q) => q.id !== next.id && q.plan?.key === next.plan?.key)) return `${next.plan?.key} already has a request.`;
    }
    return null;
  }
  // Where the money comes from is fixed once requested.
  if (calendar && (!same(prev.plan, next.plan) || prev.budgetLine !== next.budgetLine || prev.funding !== next.funding)) return "The budget line and funding are fixed when the request is made.";
  if (register) {
    const why = checkSupplier(prev, next, register);
    if (why) return why;
  }
  if (next.id !== prev.id) return "A procurement's reference cannot change.";

  // History: append-only.
  if ((next.timeline ?? []).length < (prev.timeline ?? []).length || !sameHistory((next.timeline ?? []).slice(0, prev.timeline.length), prev.timeline)) return "The procurement's history cannot be changed or removed.";
  if ((next.timeline ?? []).slice((prev.timeline ?? []).length).some((t) => t.by !== undefined && t.by !== u.name)) return "A history entry is recorded in your own name.";

  const fieldsChanged = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => !FREE.has(k) && !same((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]));

  if (prev.step === DONE) {
    if (fieldsChanged.length || !same(prev.signatures, next.signatures) || !same(prev.checks, next.checks) || next.step !== DONE || !same(prev.payments, next.payments) || !same(prev.distribution, next.distribution)) return "This procurement is closed: only documents and issues can still be added.";
    return null;
  }

  const owner = ownerOf(prev);
  const ownsStep = !!owner && maySign(u, prev, owner);
  // An instalment paid: its signatures and checks are filed into the payment record and start clean.
  // The server rebuilds exactly what that must look like; anything else is refused.
  const archived = prev.step === "paid" && (next.payments?.length ?? 0) > (prev.payments?.length ?? 0);
  if (archived) {
    if (!ownsStep) return "Only Finance records a payment.";
    if (!ready(prev)) return "“Record the payment” is not complete: record the proof of payment and tick its checks first.";
    const expected = { ...closeInstalment(prev), step: nextStep(prev) };
    const strip = (x: Procurement) => ({ ...x, timeline: undefined, updatedAt: undefined, links: undefined, issues: undefined, rev: undefined });
    if (!same(strip(next), strip(expected))) return "A paid instalment is filed exactly as recorded: reload the procurement and record the payment again.";
    return null;
  }
  // Paid instalments are history: never changed or removed.
  if (!same(prev.payments ?? [], next.payments ?? [])) return "A paid instalment cannot be changed or removed.";

  // Signatures: append-only, each new one the signer's own and theirs to give.
  for (const doc of new Set([...Object.keys(prev.signatures ?? {}), ...Object.keys(next.signatures ?? {})])) {
    const before = prev.signatures?.[doc] ?? [];
    const after = next.signatures?.[doc] ?? [];
    if (!archived && (after.length < before.length || !same(after.slice(0, before.length), before))) return `A signature on the ${doc.toLowerCase()} cannot be removed or changed.`;
    for (const sig of after.filter((s) => !before.some((b) => same(b, s)))) {
      if (sig.name !== u.name) return `A signature must be your own: “${sig.as}” on the ${doc.toLowerCase()} names ${sig.name}.`;
      if (!maySign(u, prev, sig.role as Role)) return `You cannot sign as ${roleLabel(sig.role as Role)} on this procurement.`;
      if (sig.role === "approver" && requesterOf(prev) === u.name) {
        // Solo mode (server/solo.ts): the requester may approve, confirming it, unless the approval needs a second person.
        const refusal = "The person who requested a purchase cannot approve it.";
        if (!solo.on) return refusal;
        if (solo.blocked) return `${refusal} ${solo.blocked}`;
        const barred = soloBarred(prev);
        if (barred) return `${refusal} ${barred}`;
        if (!sig.self) return "Confirm that you requested this and are approving it yourself.";
      } else if (sig.self) return "Only the person who requested a purchase marks an approval as their own.";
    }
  }

  // Step: forward once complete, or back one where allowed; only by the step's owner.
  if (next.step !== prev.step) {
    if (!ownsStep) return `Only the ${owner ? roleLabel(owner) : "step's owner"} can move this procurement on from “${stepById[prev.step]?.title ?? prev.step}”.`;
    if (next.step === prevStep(prev) && next.step !== prev.step) {
      if (!stepById[prev.step]?.canReturn) return "This step cannot be sent back.";
    } else {
      const atStep = { ...next, step: prev.step };
      if (!archived && !ready(atStep)) return `“${stepById[prev.step]?.title ?? prev.step}” is not complete: finish its checks, review its document and close blocking issues first.`;
      const sigs = prev.signatures["Expense voucher"] ?? [];
      const preparer = sigs.find((x) => x.as === "Prepared and entered by (finance)")?.name;
      const reviewer = sigs.find((x) => x.as === "Reviewed by (finance)")?.name;
      if ((prev.step === "voucherReview" || prev.step === "voucherApprove") && preparer === u.name)
        return prev.step === "voucherReview" ? "The voucher must be reviewed by someone other than the person who prepared it." : "The voucher must be approved by someone other than the person who prepared it.";
      // Three signatures, three people where Finance has three: the reviewer approves only on a smaller team.
      if (prev.step === "voucherApprove" && reviewer === u.name && holdersFor(prev, "finance").some((h) => h.name !== preparer && h.name !== reviewer))
        return `The voucher must be approved by a third Finance person: ${otherHolder(prev, "finance", [preparer ?? "", reviewer ?? ""])?.name ?? "someone other than the reviewer"}.`;
      if (prev.step === "verifyPay" && (prev.signatures["Payment approval form"] ?? []).some((x) => x.as === "Checked by (finance)" && x.name === u.name)) return "The second Finance check must be done by someone other than the first.";
      if (!archived && next.step !== nextStep(atStep)) return `That is not the next step after “${stepById[prev.step]?.title ?? prev.step}”.`;
    }
  }

  const dist = checkDistribution(prev, next, u);
  if (dist) return dist;
  const receiver = checkReceiver(prev, next, u);
  if (receiver) return receiver;

  // Bids as received are fixed once their step is done: only judging, scoring and choosing follow.
  if (!["quotes", "bids"].includes(prev.step)) {
    const core = (b: NonNullable<Procurement["bids"]>[number]) => ({ s: b.supplier, i: b.supplierId, r: b.receivedAt, a: b.amount, c: b.currency, x: b.rate, e: b.evidence });
    if (!same((prev.bids ?? []).map(core), (next.bids ?? []).map(core))) return "Bids are recorded as received, at the quotation or opening step; they cannot be added or changed afterwards.";
    if (prev.opening && !same(prev.opening, next.opening)) return "The bid opening record cannot change after the opening step.";
  }
  if (register && next.supplier?.id && next.selectedBid && !same(prev.supplier, next.supplier)) {
    const chosen = (next.bids ?? []).find((b) => b.id === next.selectedBid);
    if (chosen?.supplierId && chosen.supplierId !== next.supplier.id) return `The supplier screened must be the one whose bid was chosen (${chosen.supplier}).`;
  }

  // Checks and fields: only the step's owner (the budget holder while the request is being prepared).
  const checksChanged = [...new Set([...Object.keys(prev.checks ?? {}), ...Object.keys(next.checks ?? {})])].filter((k) => !!prev.checks?.[k] !== !!next.checks?.[k]);
  if (!archived && checksChanged.length) {
    const barred = voucherBarred(prev, u.name);
    if (barred) return barred;
    if (!ownsStep) return `Only the ${owner ? roleLabel(owner) : "step's owner"} can tick the checks for “${stepById[prev.step]?.title ?? prev.step}”.`;
    const mine = (k: string) => k === `review.${prev.step}` || k.startsWith(`${prev.step}.`) || k.startsWith(`fix.${prev.step}.`);
    const other = checksChanged.find((k) => !mine(k));
    if (other) return "Only the checks of the step under way can change.";
    // A failed automatic check can be overridden only where the step offers it, with its resolution.
    const badFix = checksChanged.find((k) => k.startsWith("fix.") && next.checks?.[k] && !stepById[prev.step]?.checks.find((c) => `fix.${prev.step}.${c.id}` === k)?.resolve);
    if (badFix) return "That check cannot be overridden.";
    // R2-03: an override is recorded with its reason, in the name of whoever ticks it.
    const bare = checksChanged.find((k) => k.startsWith("fix.") && next.checks?.[k] && !prev.checks?.[k] && ((next.overrides?.[k]?.why ?? "").trim().length < 10 || next.overrides?.[k]?.by !== u.name));
    if (bare) return "Record why the check is overridden (a reason of at least a few words, in your own name).";
  }
  // A second person's confirmation of an override (ISS-17): someone other than who recorded it, and
  // the procurement manager or an administrator.
  for (const [k, o] of Object.entries(next.overrides ?? {})) {
    const was = prev.overrides?.[k];
    if (!o.confirmedBy || same(was?.confirmedBy, o.confirmedBy)) continue;
    if (o.confirmedBy.name !== u.name) return "A confirmation is signed by the person confirming.";
    if (o.by === u.name || was?.by === u.name) return "You recorded this, so a second person confirms it.";
    const check = stepById[k.split(".")[1]]?.checks.find((c) => `fix.${k.split(".")[1]}.${c.id}` === k);
    if (check?.secondBy === "finance") {
      if (!u.admin && !procRolesFor(u).includes("finance")) return "Only Finance confirms a budget revision.";
    } else if (!u.admin && !isProcurementManager(u)) return "Only the procurement manager confirms this.";
  }
  // Each part of the record changes only at its own steps.
  const outOfStep = fieldsChanged.find((k) => k in FIELD_STEPS && !FIELD_STEPS[k].includes(prev.step));
  if (outOfStep) return `${outOfStep} cannot change at “${stepById[prev.step]?.title ?? prev.step}”.`;
  // Review and approval do not recode the voucher: its coding and number stay as the preparer entered them in NetSuite. The approver files it.
  if ((prev.step === "voucherReview" || prev.step === "voucherApprove") && fieldsChanged.includes("voucher") && !same({ ...prev.voucher, sharepointUrl: "" }, { ...next.voucher, sharepointUrl: "" }))
    return `At review and approval only the ${storeNames()} link is added. To change the coding, send the voucher back to the person who prepared it.`;
  if (fieldsChanged.length && !ownsStep) return `Only the ${owner ? roleLabel(owner) : "step's owner"} can change this procurement's details at “${stepById[prev.step]?.title ?? prev.step}” (${fieldsChanged.slice(0, 3).join(", ")}).`;
  return null;
}

/** What a save changed, for the audit trail. */
export function describeProcurementSave(prev: Procurement | undefined, next: Procurement) {
  if (!prev) return { procurement: next.id, created: true, title: next.title, step: next.step };
  const sigs = Object.entries(next.signatures ?? {}).flatMap(([doc, l]) => l.filter((s) => !(prev.signatures?.[doc] ?? []).some((b) => same(b, s))).map((s) => `${s.as} (${doc})`));
  const fields = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => !FREE.has(k) && !same((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]));
  const checks = [...new Set([...Object.keys(prev.checks ?? {}), ...Object.keys(next.checks ?? {})])].filter((k) => !!prev.checks?.[k] !== !!next.checks?.[k]);
  const own = Object.values(next.signatures ?? {}).flat().filter((x) => x.self && !Object.values(prev.signatures ?? {}).flat().some((b) => same(b, x)));
  return { procurement: next.id, title: next.title, step: prev.step === next.step ? next.step : { from: prev.step, to: next.step }, signed: sigs, checks: checks.length, fields, added: (next.timeline ?? []).slice(prev.timeline.length).map((t) => t.what), ...(own.length ? { selfApproved: true, ...(own[0].self!.note ? { soloNote: own[0].self!.note } : {}) } : {}) };
}
