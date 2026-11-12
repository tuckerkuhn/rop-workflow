"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { SelfConfirmSheet, useSolo } from "@/components/app/self-confirm";
import { useDonors, usePlan, useProcurements } from "@/components/app/use-project-data";
import type { BudgetLine as ProjectBudgetLine, WorkplanItem } from "@/lib/budget";
import { METHOD, toUsd, type PlanItem } from "@/lib/procurement-plan";
import { activityHref, resultHref, workplanOfProcurement } from "@/lib/connections";
import { AiCheck, DraftPanel, RoutePicker, SoleFacts, SupplierField, VoucherPanel, type DraftKind } from "@/components/procurement/route-panels";
import { useSupplierRegister, type SupplierRow } from "@/components/procurement/suppliers-page";
import { BidsPanel, DistributionPanel } from "@/components/procurement/bid-panels";
import { DocumentViewer } from "@/components/procurement/document";
import { PaidPanel, PayFormPanel, PayFormSummary, PaymentsList, ReceiptPanel, SchedulePanel } from "@/components/procurement/payment-panels";
import { asPaid, type PaymentRecord } from "@/lib/payments";
import {
  AppShell,
  BackLink,
  NoAccess,
  CheckRow,
  ComingUp,
  EmptyQueue,
  History,
  IssueForm,
  IssueList,
  Pill,
  QueueFooter,
  QueueHeader,
  QueueItem,
  SectionLabel,
  StepCard,
  Tracker,
  primaryBtn,
  quietBtn,
} from "@/components/workspace/ui";
import { AFN_PER_USD, projectPath, stepHistory, userById } from "@/lib/demo";
import {
  DONE,
  blockingIssues,
  budgetLines,
  checkState,
  completeStep,
  documentsOf,
  issueHelp,
  issueTypes,
  levelFor,
  lineOf,
  ownerOf,
  prevStep,
  ready,
  reviewKey,
  roleLabel,
  rolePersonFor,
  holderFor,
  roles,
  stages,
  stepById,
  stepsFor,
  valueOf,
  type Issue,
  type Procurement,
  type Role,
  maySign,
  procRolesFor,
  typeFor,
  setProcurementSet,
  setSupplierRegister,
  receivedQty,
  isSharePointUrl,
  type DocLink,
  requesterOf,
  soloBarred,
} from "@/lib/procurement";
import { holdersOfType } from "@/lib/authority";
import { ROLE_LABEL } from "@/lib/hr";
import { today } from "@/lib/clock";


const fieldCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

const ISSUE_FOOTNOTE =
  "Suspected fraud, bribery, collusion or a supplier protest? Do not record it here. Use the reporting channel in the Whistleblower Policy (until it is issued, the Grievance Redressal Procedures).";

/** Procurements that will reach `role` later, with the projected arrival date. */
export function procurementComingTo(items: Procurement[], role: string) {
  return items
    .filter((p) => p.step !== DONE && ownerOf(p) !== role)
    .flatMap((p) => {
      const list = stepsFor(p);
      const i = list.findIndex((s) => s.id === p.step);
      const since = p.timeline.length ? p.timeline[p.timeline.length - 1].date : today();
      const path = projectPath(
        list.slice(i).map((s) => ({ step: s.id, owner: s.owner })),
        since,
        today(),
      );
      const hit = path.find((x, k) => k > 0 && x.owner === role);
      if (!hit) return [];
      return [
        {
          id: p.id,
          title: `${p.title} · ${p.id}`,
          step: stepById[hit.step].title,
          eta: hit.start,
          via: `${lowerFirst(stepById[path[0].step].title)} with ${holderFor(p, path[0].owner as Role)?.name ?? roleLabel(path[0].owner as Role)}`,
          basis: path
            .slice(0, path.indexOf(hit))
            .map((x) => `${stepById[x.step].title}: median ${stepHistory[x.step]?.median} days (${stepHistory[x.step]?.n} cases)`)
            .join(" · "),
        },
      ];
    })
    .sort((a, b) => a.eta.localeCompare(b.eta));
}

/* ---------- requisition form ---------- */

function RequisitionForm({ p, editable, update }: { p: Procurement; editable: boolean; update: (fn: (p: Procurement) => Procurement) => void }) {
  const { money, currency } = useSession();
  const toUsd = (v: number) => (currency === "AFN" ? v / AFN_PER_USD : v);
  const fromUsd = (v: number) => (currency === "AFN" ? Math.round(v * AFN_PER_USD) : v);
  // Any edit after review means the document must be reviewed again before signing.
  const set = (patch: Partial<Procurement>) =>
    update((q) => {
      const checks = { ...q.checks };
      delete checks[reviewKey(q)];
      return { ...q, ...patch, checks };
    });
  const line = lineOf(p);
  return (
    <div className="border-b border-line bg-paper/60 px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Requisition details</p>
        <p className="text-xs text-muted">{editable ? "Fill in here. The requisition document is generated from these fields." : "Filled in by the budget holder."}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Item</span>
          <input id="rq-title" disabled={!editable} value={p.title} onChange={(e) => set({ title: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Specification</span>
          <textarea id="rq-spec" disabled={!editable} rows={2} value={p.specification} onChange={(e) => set({ specification: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Quantity</span>
          <div className="mt-1 flex gap-2">
            <input id="rq-qty" disabled={!editable} inputMode="decimal" value={p.qty} onChange={(e) => set({ qty: Number(e.target.value) || 0 })} className={fieldCls} />
            <input id="rq-unit" disabled={!editable} aria-label="Unit" value={p.unit} onChange={(e) => set({ unit: e.target.value })} className={`${fieldCls} w-24`} />
          </div>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Estimated unit price ({currency === "AFN" ? "Afs" : "USD"})</span>
          <input
            id="rq-price"
            disabled={!editable}
            inputMode="decimal"
            value={fromUsd(p.unitPrice)}
            onChange={(e) => set({ unitPrice: toUsd(Number(e.target.value) || 0) })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Budget line</span>
          {p.plan ? (
            <p className={`mt-1 ${fieldCls} bg-sunken`}>
              {p.plan.budgetCode} {p.plan.budgetName.slice(0, 80)}
            </p>
          ) : (
            <select id="rq-line" disabled={!editable} value={p.budgetLine} onChange={(e) => set({ budgetLine: e.target.value })} className={`mt-1 ${fieldCls}`}>
              {budgetLines.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} {b.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Needed by</span>
          <input id="rq-date" type="date" disabled={!editable} value={p.neededBy} onChange={(e) => set({ neededBy: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Delivery place</span>
          <input id="rq-place" disabled={!editable} value={p.place} onChange={(e) => set({ place: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input id="rq-urgent" type="checkbox" disabled={!editable} checked={p.urgent} onChange={(e) => set({ urgent: e.target.checked })} className="h-4 w-4 accent-[var(--forest)]" />
          {p.plan ? `From procurement calendar ${p.plan.key}` : "Urgent (not in the procurement plan)"}
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Environmental or social risk</span>
          <input
            id="rq-es"
            disabled={!editable}
            value={p.esRisk}
            placeholder="e.g. None identified, or: pesticide, storage and disposal plan attached"
            onChange={(e) => set({ esRisk: e.target.value })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Price basis (source of the estimate)</span>
          <input
            id="rq-basis"
            disabled={!editable}
            value={p.priceBasis}
            placeholder="e.g. Last purchase PR-2026-031 and a survey of three suppliers"
            onChange={(e) => set({ priceBasis: e.target.value })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
      </div>
      <p className="mt-3 text-sm text-muted">
        Estimated total <span className="font-semibold text-ink tabular-nums">{money(valueOf(p))}</span> · {levelFor(valueOf(p))} level
        {line && (
          <>
            {" "}
            · {money(line.remainingValue)} left on {line.code}
          </>
        )}
      </p>
    </div>
  );
}

/* ---------- new request ---------- */

/** What a request started from the procurement calendar brings with it. */
export type FromPlan = { item: PlanItem; line: ProjectBudgetLine | null; wp: WorkplanItem | null; projectName: string; funding: string };

/** The in-kind grant a request is started from (lib/connections.ts): it buys that grant's equipment. */
export type ForGrant = { id: string; business: string; purpose: string; value: number };

function NewRequest({ onCancel, onCreate, from, grant }: { onCancel: () => void; onCreate: (p: Procurement) => void; from?: FromPlan; grant?: ForGrant | null }) {
  const { money, currency, user } = useSession();
  const { date } = useT();
  const item = from?.item;
  const startQty = item ? (item.quantity && item.quantity > 0 ? item.quantity : 1) : 0;
  // From the exact amount in the budget currency, not the rounded USD figure.
  const startUnitUsd = item ? toUsd(item.value, item.currency) / startQty : 0;
  const shown = (usd: number) => (currency === "AFN" ? Math.round(usd * AFN_PER_USD) : Math.round(usd * 100) / 100);
  const [title, setTitle] = useState(grant ? grant.purpose || `Equipment for ${grant.business}` : (item?.title ?? ""));
  const [spec, setSpec] = useState("");
  // A grant's equipment is one lot at the grant's value, until the specification says otherwise.
  const [qty, setQty] = useState(grant ? "1" : item ? String(startQty) : "");
  const [unit, setUnit] = useState(grant ? "lot" : item ? (item.quantity ? (item.unit ?? "units") : "lot") : "units");
  const [price, setPrice] = useState(grant ? String(shown(grant.value)) : item ? String(shown(startUnitUsd)) : "");
  const [line, setLine] = useState(budgetLines[0].code);
  const [neededBy, setNeededBy] = useState(item?.neededBy ?? "2027-04-30");
  const [place, setPlace] = useState("");
  const [urgent, setUrgent] = useState(false);
  const unitUsd = (Number(price) || 0) / (currency === "AFN" ? AFN_PER_USD : 1);
  const value = (Number(qty) || 0) * unitUsd;
  const bl = item ? { code: item.budgetCode ?? "", name: item.title, remainingValue: toUsd(item.value, item.currency) } : budgetLines.find((b) => b.code === line)!;
  const valid = title.trim() && Number(qty) > 0 && Number(price) > 0 && (!item || (spec.trim() && place.trim()));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate({
          id: `PR-2027-${String(Math.floor(Math.random() * 900) + 100)}`,
          title: title.trim(),
          specification: spec.trim(),
          priceBasis: "",
          esRisk: "",
          signatures: {},
          qty: Number(qty),
          unit,
          unitPrice: unitUsd,
          budgetLine: item ? (item.budgetCode ?? "") : line,
          activity: item ? [from?.line?.activityCode, from?.line?.activity ?? from?.wp?.title].filter(Boolean).join(" ") || item.title : "1.2 Maize demonstration plots, 2027 Spring",
          funding: from ? from.funding : "Award A-2027 (fictional) · body rules apply",
          neededBy,
          place: item ? place.trim() : "Village B collection point",
          urgent: item ? false : urgent,
          step: "need",
          checks: {},
          issues: [],
          timeline: [{ date: today(), who: "holder", what: (item ? `Request created from procurement calendar ${item.key}` : "Request created") + (grant ? ` for grant ${grant.id} (${grant.business})` : "") }],
          ...(grant ? { grant: grant.id } : {}),
          ...(item
            ? {
                plan: {
                  key: item.key,
                  project: from!.projectName,
                  budgetCode: item.budgetCode ?? "",
                  budgetName: from?.line?.description ?? item.title,
                  leftUsd: toUsd(item.value, item.currency),
                  left: item.value,
                  currency: item.currency,
                  requestedBy: user?.name ?? "Technical lead",
                  requestedById: user?.id,
                  approvedBy: [item.approvals.manager, item.approvals.lead].filter((a): a is NonNullable<typeof a> => !!a).map((a) => (a.for ? `${a.name} for ${a.for}` : a.name)),
                },
              }
            : {}),
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          {item ? `Procurement request · ${item.key}` : "New request"}
          {grant ? ` · for grant ${grant.id}, ${grant.business}` : ""}
        </p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">{item ? "Check and complete the request" : "What do you need?"}</h2>
        <p className="mt-1 text-sm text-muted">
          {item
            ? "Filled in from the approved procurement calendar. Check every field, add the specification and where it is delivered, then create it. You will review the generated document and sign it in the next steps."
            : "This starts the purchase requisition. You will finish it, review the generated document and sign it in the next steps."}
        </p>
      </div>
      {item && from && (
        <section className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">From the plan</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[9rem_1fr]">
            <dt className="text-muted">Budget line</dt>
            <dd>
              <span className="font-mono text-xs">{item.budgetCode}</span> {from.line?.description ?? item.title}
              {from.line && (
                <span className="block text-xs text-muted">
                  {from.line.quantity !== null ? `${from.line.quantity} ${from.line.unit ?? ""} · ` : ""}
                  {from.line.spent ? "partly spent · " : ""}
                  {item.value.toLocaleString("en-US")} {item.currency} left
                </span>
              )}
            </dd>
            {from.line?.activity && (
              <>
                <dt className="text-muted">Activity</dt>
                <dd>
                  {from.line.activityCode} {from.line.activity}
                </dd>
              </>
            )}
            {from.wp && (
              <>
                <dt className="text-muted">Workplan</dt>
                <dd>
                  <span className="font-mono text-xs">{from.wp.code}</span> {from.wp.title}
                  {from.wp.indicator && <span className="block text-xs text-muted">{from.wp.indicator}</span>}
                </dd>
              </>
            )}
            <dt className="text-muted">How it is bought</dt>
            <dd>
              {METHOD[item.level].title} <span className="text-xs text-muted">({item.level})</span>
            </dd>
            <dt className="text-muted">Needed by</dt>
            <dd>
              {date(item.neededBy, { day: "numeric", month: "short", year: "numeric" })} <span className="text-xs text-muted">{item.neededWhy}</span>
            </dd>
            <dt className="text-muted">Approved by</dt>
            <dd>{[item.approvals.manager, item.approvals.lead].filter(Boolean).map((a) => a!.name + (a!.for ? ` for ${a!.for}` : "")).join(" and ")}</dd>
          </dl>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Item</span>
          <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hybrid maize seed" className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Specification{item ? " (required)" : ""}</span>
          <textarea
            id="nr-spec"
            rows={3}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder={item ? "What exactly is needed: type, size, quality standard, delivery and any installation or training. Describe the need without naming a brand." : undefined}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
        <label>
          <span className="text-sm font-medium">Quantity</span>
          <div className="mt-1 flex gap-2">
            <input id="nr-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={fieldCls} />
            <input id="nr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${fieldCls} w-24`} aria-label="Unit" />
          </div>
        </label>
        <label>
          <span className="text-sm font-medium">Estimated unit price ({currency === "AFN" ? "Afs" : "USD"})</span>
          <input id="nr-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={`mt-1 ${fieldCls}`} />
        </label>
        {item ? (
          <label>
            <span className="text-sm font-medium">Delivery place (required)</span>
            <input id="nr-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. ROP Kabul office, or district and village" className={`mt-1 ${fieldCls}`} />
          </label>
        ) : (
          <label>
            <span className="text-sm font-medium">Budget line</span>
            <select id="nr-line" value={line} onChange={(e) => setLine(e.target.value)} className={`mt-1 ${fieldCls}`}>
              {budgetLines.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="text-sm font-medium">Needed by</span>
          <input id="nr-date" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={`mt-1 ${fieldCls}`} />
        </label>
        {!item && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input id="nr-urgent" type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
            Urgent (not in the procurement plan)
          </label>
        )}
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          ["Estimated value", money(value)],
          ["Level", value > 0 ? levelFor(value) : "—"],
          ["Left on line", money(bl.remainingValue)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className={`mt-1 font-display text-xl tabular-nums ${k === "Left on line" && value > bl.remainingValue ? "text-clay" : ""}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={!valid} className={primaryBtn}>
          Create request
        </button>
        {item && !valid && <span className="self-center text-xs text-muted">Add the specification and delivery place to continue.</span>}
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ---------- detail ---------- */

function Detail({
  p,
  role,
  update,
  onBack,
  onDraft,
  onCheck,
  register,
  links,
}: {
  register?: SupplierRow[] | null;
  /** Where it sits among the other workflows: its project, and the workplan sub-activity it serves. */
  links?: { project: string; activity: { code: string; title: string } | null };
  p: Procurement;
  role: Role | null;
  update: (fn: (p: Procurement) => Procurement) => void;
  onBack: () => void;
  onDraft: (kind: DraftKind) => Promise<unknown>;
  onCheck: () => Promise<unknown>;
}) {
  const { user, money, signIn, mode } = useSession();
  const [raising, setRaising] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const { project: current } = useCurrentProject();
  const solo = useSolo(current.saved ? current.id : null, user?.id);
  const [selfing, setSelfing] = useState(false);
  const [viewing, setViewing] = useState<{ doc: string; confirm: boolean; paid?: PaymentRecord } | null>(null);
  const step = stepById[p.step];
  const owner = ownerOf(p);
  const ownerUser = owner ? holderFor(p, owner) : undefined;
  // The second Finance check is someone other than the person who did the first.
  const checkedBySelf = p.step === "verifyPay" && !!user && (p.signatures["Payment approval form"] ?? []).some((x) => x.as === "Checked by (finance)" && x.name === user.name);
  const mine = !!role && owner === role && maySign(user, p, role) && !checkedBySelf;
  // A step this person's role covers but whose signature needs another role type (a large award, a sole source).
  const needsOther = !!role && owner === role && !mine && !checkedBySelf ? typeFor(p, role) : null;
  // The requester approving their own purchase: only in solo mode, confirmed, and never a large award, sole source or exception.
  const ownApproval = mine && owner === "approver" && !!user && requesterOf(p) === user.name;
  const ownBarred = ownApproval ? soloBarred(p) : null;
  const mayOwn = ownApproval && solo && !ownBarred;
  const value = valueOf(p);
  const line = lineOf(p);
  const isReady = ready(p);
  const blocks = blockingIssues(p);
  const docs = documentsOf(p);
  const reviewed = !!p.checks[reviewKey(p)];
  const letters: Record<number, string[]> = {};
  stepsFor(p).forEach((s) => s.gate && (letters[s.stage] = [...(letters[s.stage] ?? []), s.gate]));
  const gates = Object.fromEntries(Object.entries(letters).map(([k, g]) => [k, `${g.length > 1 ? "Gates" : "Gate"} ${g.join("·")}`]));

  const log = (q: Procurement, what: string): Procurement => ({ ...q, timeline: [...q.timeline, { date: today(), who: role ?? "procurement", what }] });

  const complete = (self?: { note: string }) =>
    update((q) => {
      const s = stepById[q.step];
      return log(completeStep(q, { name: user?.name ?? roleLabel(s.owner), date: today(), ...(self ? { self } : {}) }), s.signs ? `${s.done} · signed ${s.signs.doc.toLowerCase()}${self ? " (self-approved, solo mode)" : ""}` : s.done);
    });

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{p.id}</span>
          <Pill tone="muted">{levelFor(value)}</Pill>
          {p.urgent && <Pill tone="clay">Urgent</Pill>}
          {p.feeds && <Pill tone="sky">Feeds field inputs</Pill>}
          {p.grant && links && (
            <Link href={`/work/grants?project=${encodeURIComponent(links.project)}&open=${p.grant}`} className="text-xs font-semibold text-forest hover:underline">
              For grant {p.grant}
            </Link>
          )}
        </div>
        <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight">{p.title}</h2>
        {links?.activity && (
          <Link href={activityHref(links.project, links.activity.code)} className="mt-1 block text-sm text-forest hover:underline">
            For {links.activity.code} {links.activity.title.slice(0, 80)}
          </Link>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
            ["Value", money(value)],
            ["Budget line", line ? `${line.code} ${line.name}` : p.budgetLine],
            ["Needed by", p.neededBy],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 truncate tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {p.supplier && <p className="mt-3 text-sm text-muted">Supplier: {p.supplier.name}</p>}
      </div>

      <div className="rounded-2xl border border-line bg-surface px-4 py-4">
        <Tracker labels={stages} current={p.step === DONE ? stages.length : step.stage} marks={gates} />
      </div>

      {p.step === DONE ? (
        <div className="rounded-2xl border border-forest/30 bg-mist p-6">
          <p className="font-display text-2xl text-forest">Closed</p>
          <p className="mt-1 text-sm text-muted">The file is complete and every document carries {p.id}.</p>
        </div>
      ) : (
        <>
          {checkedBySelf && <p className="rounded-xl bg-ochre-soft px-4 py-3 text-sm text-ochre">You checked this payment, so another Finance person verifies it.</p>}
          {needsOther && (
            <p className="rounded-xl bg-ochre-soft px-4 py-3 text-sm text-ochre">
              This signature needs the {ROLE_LABEL[needsOther].toLowerCase()} ({holdersOfType(needsOther).map((id) => userById(id)?.name ?? id).join(" or ") || "nobody named in the authority table"}):{" "}
              {needsOther === "ceo" ? "large awards and every sole source go to the executive head." : "it is outside your role."}
            </p>
          )}
        <StepCard
          mine={mine}
          ownerLabel={rolePersonFor(p, owner!)}
          eyebrow={step.gate && `Gate ${step.gate}`}
          title={step.title}
          note={step.note}
          onViewAs={ownerUser && mode === "demo" ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? `Sign in as ${ownerUser.name.split(" ")[0]} (demo)` : undefined}
          footer={
            <>
              {mine && (
                <div className="space-y-3 border-t border-line px-5 py-4">
                  {blocks.length > 0 && (
                    <p className="text-sm font-medium text-clay">{blocks.length === 1 ? "An open issue is" : `${blocks.length} open issues are`} holding this step.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {ownApproval && !mayOwn ? (
                      <p className="text-sm text-ochre">The person who requested a purchase cannot approve it, so someone else signs here.{ownBarred && solo ? ` ${ownBarred}` : ""}</p>
                    ) : (
                      <button type="button" disabled={!isReady} onClick={() => (mayOwn ? setSelfing(true) : complete())} className={primaryBtn}>
                        {step.signs ? `Sign and ${lowerFirst(step.action)}` : step.action} →
                      </button>
                    )}
                    {selfing && (
                      <SelfConfirmSheet
                        what={`${p.id} · ${step.title}`}
                        onCancel={() => setSelfing(false)}
                        onConfirm={(self) => {
                          complete({ note: self.note });
                          setSelfing(false);
                        }}
                      />
                    )}
                    {step.canReturn && !returning && (
                      <button type="button" onClick={() => setReturning(true)} className="rounded-full border border-line px-4 py-3 text-sm font-medium hover:border-clay hover:text-clay">
                        Return with comments
                      </button>
                    )}
                    {raising === null && (
                      <button type="button" onClick={() => setRaising("")} className="rounded-full px-4 py-3 text-sm font-medium text-muted hover:text-ink">
                        + Raise issue
                      </button>
                    )}
                  </div>
                  {!isReady && blocks.length === 0 && (
                    <p className="text-xs text-muted">{step.signs && !reviewed ? "Review the generated document and complete every item to continue." : "Complete every item above to continue."}</p>
                  )}
                  {returning && (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!returnNote.trim()) return;
                        update((q) => log({ ...q, step: prevStep(q) }, `Returned: ${returnNote.trim()}`));
                        setReturning(false);
                        setReturnNote("");
                      }}
                    >
                      <input
                        id="return-note"
                        autoFocus
                        value={returnNote}
                        onChange={(e) => setReturnNote(e.target.value)}
                        placeholder="What needs to change?"
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-clay focus:outline-none"
                      />
                      <button type="submit" className="rounded-full bg-clay px-4 py-2 text-sm font-medium text-white">
                        Return
                      </button>
                      <button type="button" onClick={() => setReturning(false)} className="px-2 text-sm text-muted">
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              )}
              {raising !== null && role && (
                <div className="border-t border-line px-5 py-4">
                  <IssueForm
                    types={issueTypes}
                    help={issueHelp}
                    footnote={ISSUE_FOOTNOTE}
                    initial={raising}
                    onCancel={() => setRaising(null)}
                    onSave={(i) => {
                      update((q) =>
                        log(
                          { ...q, issues: [...q.issues, { ...i, type: i.type as Issue["type"], id: `I-${q.issues.length + 1}`, by: role, status: "open" }] },
                          `Issue raised: ${i.type}`,
                        ),
                      );
                      setRaising(null);
                    }}
                  />
                </div>
              )}
            </>
          }
        >
          {p.step === "requisition" && <RequisitionForm p={p} editable={mine} update={update} />}
          {p.step === "route" && <RoutePicker p={p} editable={mine} update={update} />}
          {p.step === "screen" && <SupplierField p={p} editable={mine} update={update} register={register} />}
          {["quotes", "bids", "evaluateWaived", "evaluate"].includes(p.step) && <BidsPanel p={p} editable={mine} update={update} register={register} money={money} />}
          {p.step === "soleSource" && <SoleFacts p={p} editable={mine} update={update} />}
          {(p.step === "rfq" || p.step === "solicitation" || p.step === "soleSource") && (
            <DraftPanel p={p} kind={p.step === "soleSource" ? "sole" : p.step === "rfq" ? "rfq" : "solicitation"} editable={mine} update={update} onDraft={onDraft} />
          )}
          {p.step === "approveSole" && p.drafts?.["Sole source justification"] && (
            <DraftPanel p={p} kind="sole" editable={false} update={update} onDraft={onDraft} />
          )}
          {p.step === "package" && <DraftPanel p={p} kind="package" editable={mine} update={update} onDraft={onDraft} />}
          {p.step === "contract" && <SchedulePanel p={p} editable={mine} update={update} />}
          {p.step === "receive" && <ReceiptPanel p={p} editable={mine} update={update} />}
          {p.step === "payForm" && <PayFormPanel p={p} editable={mine} update={update} />}
          {(p.step === "payReady" || p.step === "approvePay" || p.step === "voucher") && <PayFormSummary p={p} />}
          {p.step === "paid" && <PaidPanel p={p} editable={mine} update={update} />}
          {user && (receivedQty(p) > 0 || p.distribution) && <DistributionPanel p={p} resultLink={links ? (people) => resultHref(links.project, { from: p.id, ...people, note: `${p.id}: ${p.title} handed to ${people.value} people (${people.female} women)${people.place ? ` at ${people.place}` : ""}, from signed distribution lists.` }) : undefined} canEdit={user.procurementAccess === "edit"} update={update} me={{ id: user.id, name: user.name }} />}
          {p.step === "voucher" && <VoucherPanel p={p} editable={mine} update={update} />}
          {step.checks.some((c) => c.ai) && <AiCheck p={p} editable={mine} onCheck={onCheck} />}
          <ul className="divide-y divide-line px-5">
            {step.checks.map((c) => {
              const s = checkState(p, c, money);
              return (
                <CheckRow
                  key={c.id}
                  c={{
                    key: `${p.id}-${p.step}-${c.id}`,
                    label: c.label,
                    why: c.why,
                    tag: c.tag,
                    ...s,
                    findings: c.ai ? p.ai?.[p.step] : undefined,
                    fix: c.fix,
                    resolve: c.resolve,
                  }}
                  canEdit={mine}
                  onToggle={() => update((q) => ({ ...q, checks: { ...q.checks, [`${q.step}.${c.id}`]: !q.checks[`${q.step}.${c.id}`] } }))}
                  onRaise={(note) => setRaising(note)}
                  onResolve={() => update((q) => log({ ...q, checks: { ...q.checks, [`fix.${q.step}.${c.id}`]: true } }, c.resolve!))}
                />
              );
            })}
            {step.signs && (
              <li className="flex items-start gap-3 py-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${reviewed ? "bg-leaf" : "bg-line"}`}>{reviewed ? "✓" : ""}</span>
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">Review the generated {step.signs.doc.toLowerCase()}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {reviewed ? `Reviewed. You sign as “${step.signs.as}” when you continue.` : `You sign it as “${step.signs.as}” when you continue.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewing({ doc: step.signs!.doc, confirm: mine })}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${reviewed || !mine ? "border border-line hover:border-forest hover:text-forest" : "bg-forest text-forest-ink"}`}
                >
                  {reviewed || !mine ? "Open" : "Review document"}
                </button>
              </li>
            )}
          </ul>
        </StepCard>
        </>
      )}

      <IssueList
        issues={p.issues}
        roleLabel={(r) => rolePersonFor(p, r as Role)}
        canResolve={(i) => mine || i.by === role}
        onResolve={(id, note) =>
          update((q) => log({ ...q, issues: q.issues.map((x) => (x.id === id ? { ...x, status: "resolved", resolution: note } : x)) }, "Issue resolved"))
        }
      />

      <PaymentsList p={p} canFinance={!!user && procRolesFor(user).includes("finance")} update={update} onView={(r, doc) => setViewing({ doc, confirm: false, paid: r })} />

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <SectionLabel>File · {docs.length} documents</SectionLabel>
          {docs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Documents appear here as each step completes.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {docs.map((d) => {
                const signed = p.signatures[d]?.length ?? 0;
                return (
                  <li key={d}>
                    <button type="button" onClick={() => setViewing({ doc: d, confirm: false })} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-surface">
                      <span aria-hidden className="grid h-6 w-5 shrink-0 place-items-center rounded-sm border border-line bg-paper text-[8px] text-muted">
                        ▤
                      </span>
                      <span className="min-w-0 flex-1 truncate">{d}</span>
                      {signed > 0 && <span className="shrink-0 text-[11px] text-leaf">✍ {signed}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Every document is generated from this record and filed under {p.id}.</p>
          <LinkedDocs p={p} canEdit={!!user && (user.procurementAccess === "edit" || !!user.admin)} add={(l) => update((q) => log({ ...q, links: [...(q.links ?? []), l] }, `Linked ${l.title} from SharePoint`))} by={user?.name ?? ""} />
        </section>
        <History events={p.timeline} roleLabel={(r) => rolePersonFor(p, r as Role)} />
      </div>

      {viewing && (
        <DocumentViewer
          p={viewing.paid ? asPaid(p, viewing.paid) : p}
          doc={viewing.doc}
          onClose={() => setViewing(null)}
          pendingAs={mine && !viewing.paid && step?.signs?.doc === viewing.doc ? step.signs.as : undefined}
          onConfirm={viewing.confirm && !viewing.paid && !reviewed ? () => update((q) => ({ ...q, checks: { ...q.checks, [reviewKey(q)]: true } })) : undefined}
        />
      )}
    </div>
  );
}

/* ---------- workspace ---------- */

export function ProcurementWorkspace() {
  const { user } = useRequireUser();
  const myRoles = procRolesFor(user);
  const { project } = useCurrentProject();
  const { items, setItems, error, reset, draft: draftDoc, check: runCheck } = useProcurements(project.id);
  const plan = usePlan(project.saved ? project.id : null);
  const donors = useDonors(project.id);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");
  // `?grant=G-003`: the request buys an in-kind grant's equipment.
  const [grantId, setGrantId] = useState<string | null>(null);
  const [forGrant, setForGrant] = useState<ForGrant | null>(null);
  useEffect(() => {
    if (!grantId || !user) return;
    fetch(`/api/projects/${encodeURIComponent(project.id)}/grants`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { items: { id: string; business: string; purpose: string; value: number }[] } | null) => {
        const g = v?.items.find((x) => x.id === grantId);
        setForGrant(g ? { id: g.id, business: g.business, purpose: g.purpose, value: g.value } : { id: grantId, business: grantId, purpose: "", value: 0 });
      })
      .catch(() => setForGrant({ id: grantId, business: grantId, purpose: "", value: 0 }));
  }, [grantId, user, project.id]);
  // The workplan sub-activity each procurement serves, for its link up to the activity page.
  const activityOf = (p: Procurement) => {
    const code = workplanOfProcurement(p, plan.items, plan.workplan, plan.budget?.lines ?? []);
    return code ? { code, title: plan.workplan.find((w) => w.code === code)?.title ?? "" } : null;
  };
  const planItem = planKey ? plan.items.find((i) => i.key === planKey) : undefined;
  const fromPlan: FromPlan | undefined = planItem
    ? {
        item: planItem,
        line: plan.budget?.lines.find((l) => l.code === planItem.budgetCode) ?? null,
        wp: plan.workplan.find((w) => w.code === planItem.workplanCode && /rop|roots/i.test(w.org ?? "")) ?? plan.workplan.find((w) => w.code === planItem.workplanCode) ?? null,
        projectName: project.name,
        funding: [donors.map((d) => d.name).join(", "), project.name].filter(Boolean).join(" · "),
      }
    : undefined;
  const [pickedRole, setPickedRole] = useState<Role | null>(null);
  const role = pickedRole && myRoles.includes(pickedRole) ? pickedRole : (myRoles[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { money, mode } = useSession();

  // Checks that look across procurements (split purchases) read the whole project's list.
  setProcurementSet(items);
  // On a real project the supplier checks read the supplier register.
  const register = useSupplierRegister(!!project.saved && project.id !== "A-2027", user?.id);
  setSupplierRegister(register);
  const counts = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, items.filter((p) => ownerOf(p) === r.id).length])), [items]);
  const readOnly = !role;
  const mineList = role ? items.filter((p) => ownerOf(p) === role) : items;
  const list = showAll || readOnly ? items : mineList;
  const current = items.find((p) => p.id === selected) ?? list[0] ?? null;
  const upcoming = role ? procurementComingTo(items, role).slice(0, 5) : [];

  const update = (id: string) => (fn: (p: Procurement) => Procurement) => {
    setSelected(id);
    setItems((all) => all.map((p) => (p.id === id ? fn(p) : p)));
  };

  // Links such as /procurement?open=PR-2027-014 or ?new=1 open that record or the request form.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const open = q.get("open");
    if (open) {
      setSelected(open);
      setShowAll(true);
      setMobileDetail(true);
    }
    if (q.get("new")) {
      setCreating(true);
      setMobileDetail(true);
      if (q.get("plan")) setPlanKey(q.get("plan"));
      if (q.get("grant")) setGrantId(q.get("grant"));
    }
  }, []);

  if (!user) return null;
  if (user.procurementAccess === "none") return <NoAccess what="Procurement" />;

  return (
    <AppShell
      active="procurement"
      roles={roles.filter((r) => myRoles.includes(r.id))}
      role={role}
      counts={counts}
      onRole={(r) => {
        setPickedRole(r as Role);
        setSelected(null);
        setShowAll(false);
        setMobileDetail(false);
      }}
      primary={
        myRoles.includes("holder")
          ? {
              label: "+ New request",
              onClick: () => {
                setPickedRole("holder");
                setCreating(true);
                setMobileDetail(true);
              },
            }
          : undefined
      }
      mobileDetail={mobileDetail}
      queue={
        <>
          {project.saved && (
            <div className="mx-4 mt-3 grid gap-2 sm:mx-6">
              <Link href="/work/plan" className="flex items-center justify-between rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-forest hover:bg-sunken">
                Procurement calendar
                <span aria-hidden>→</span>
              </Link>
              <Link href="/work/suppliers" className="flex items-center justify-between rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-forest hover:bg-sunken">
                Suppliers
                <span aria-hidden>→</span>
              </Link>
              <Link href="/work/bills" className="flex items-center justify-between rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-forest hover:bg-sunken">
                Bills paid directly (rent, utilities, insurance)
                <span aria-hidden>→</span>
              </Link>
              {(myRoles.includes("finance") || user.admin) && (
                <Link href="/work/closeout" className="flex items-center justify-between rounded-xl bg-mist px-3 py-2 text-sm font-semibold text-forest hover:bg-sunken">
                  Monthly closeout
                  <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          )}
          <QueueHeader
            title={readOnly || showAll ? "All procurements" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            toggleLabel={readOnly ? "" : showAll ? "Mine" : "Show all"}
            onToggle={() => setShowAll(!showAll)}
          />
          {list.length === 0 ? (
            <EmptyQueue onShowAll={() => setShowAll(true)} />
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 sm:px-3">
              {list.map((p) => {
                const s = stepById[p.step];
                const late = p.step !== DONE && p.neededBy < today() && (s?.stage ?? 0) < 5;
                const o = ownerOf(p);
                return (
                  <QueueItem
                    key={p.id}
                    active={!creating && current?.id === p.id}
                    onClick={() => {
                      setSelected(p.id);
                      setCreating(false);
                      setMobileDetail(true);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted">{p.id}</span>
                      <span className="text-xs tabular-nums text-muted">{money(valueOf(p))}</span>
                    </div>
                    <p className="mt-1 font-medium leading-snug">{p.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {p.step === DONE ? (
                        <Pill tone="forest">Closed</Pill>
                      ) : (
                        <Pill tone={o === role ? "forest" : "muted"}>
                          {s.title}
                          {s.gate && ` · ${s.gate}`}
                        </Pill>
                      )}
                      {blockingIssues(p).length > 0 && <Pill tone="clay">Issue</Pill>}
                      {late && <Pill tone="ochre">Past needed-by</Pill>}
                      {(showAll || readOnly) && o && o !== role && <span className="text-[11px] text-muted">{holderFor(p, o)?.name}</span>}
                    </div>
                  </QueueItem>
                );
              })}
            </ul>
          )}
          <ComingUp
            items={upcoming}
            onOpen={(id) => {
              setSelected(id);
              setShowAll(true);
              setMobileDetail(true);
            }}
          />
          {(error || planError) && (
            <p role="alert" className="px-4 pt-3 text-sm text-clay sm:px-6">
              {error || planError}
            </p>
          )}
          <QueueFooter
            note={mode === "demo" && project.id === "A-2027" ? "Fictional records, saved in the project database. Resetting restores all sample records." : "Saved in the project database."}
            onReset={
              mode === "demo" && project.id === "A-2027"
                ? () => {
                    void reset();
                    setSelected(null);
                  }
                : undefined
            }
          />
        </>
      }
      detail={
        creating ? (
          project.saved && !planKey ? (
            <div className="mx-auto max-w-xl py-16 text-center text-sm">
              <p className="font-display text-2xl">Start from the procurement calendar</p>
              <p className="mt-2 text-muted">On this project every request charges an approved calendar item, so it carries the real budget line and the money left on it.</p>
              <Link href="/work/plan" className="mt-4 inline-block rounded-full bg-forest px-4 py-2 font-semibold text-paper">
                Open the procurement calendar
              </Link>
            </div>
          ) : planKey && !fromPlan ? (
            <div className="mx-auto max-w-xl py-16 text-center text-sm text-muted">
              {plan.status === "loading" ? "Loading the plan…" : `${planKey} is not on this project's procurement calendar.`}
            </div>
          ) : planItem && planItem.status !== "approved" ? (
            <div className="mx-auto max-w-xl py-16 text-center text-sm text-muted">
              {planItem.status === "started" ? `The request for ${planItem.key} is already made: ${planItem.procurementKey}.` : `${planItem.key} needs both approvals on the procurement calendar first.`}{" "}
              <Link href={`/work/plan?open=${planItem.key}`} className="font-semibold text-forest hover:underline">
                Open it
              </Link>
            </div>
          ) : (
          grantId && !forGrant ? (
            <div className="mx-auto max-w-xl py-16 text-center text-sm text-muted">Loading the grant…</div>
          ) : (
          <NewRequest
            key={`${planKey ?? "new"}-${forGrant?.id ?? ""}`}
            from={fromPlan}
            grant={forGrant}
            onCancel={() => {
              setCreating(false);
              setPlanKey(null);
              setGrantId(null);
              setForGrant(null);
              setMobileDetail(false);
            }}
            onCreate={(draft) => {
              // Next free number this year, so two people never get the same ID.
              const year = today().slice(0, 4);
              const used = items.map((x) => x.id.match(new RegExp(`^PR-${year}-(\\d+)$`))?.[1]).filter(Boolean).map(Number);
              const p = { ...draft, id: `PR-${year}-${String(Math.max(0, ...used) + 1).padStart(3, "0")}` };
              setItems((all) => [p, ...all]);
              setSelected(p.id);
              setCreating(false);
              // The calendar item is now started, linked to this request.
              if (p.plan)
                plan.act(p.plan.key, { action: "start", procurementKey: p.id }).catch((e) => setPlanError(`${p.id} was created, but the calendar was not updated: ${e instanceof Error ? e.message : e}`));
              setPlanKey(null);
              setGrantId(null);
              setForGrant(null);
            }}
          />
          )
          )
        ) : current ? (
          <div className="mx-auto max-w-3xl">
            <Detail key={current.id} register={register} p={current} links={{ project: project.id, activity: activityOf(current) }} role={role} update={update(current.id)} onBack={() => setMobileDetail(false)} onDraft={(kind) => draftDoc(current.id, kind)} onCheck={() => runCheck(current.id, current.step)} />
          </div>
        ) : (
          <div className="grid h-full place-items-center py-24 text-center">
            <div>
              <p className="font-display text-2xl">Nothing selected</p>
              <p className="mt-1 text-sm text-muted">Pick a procurement from the list, or start a new request.</p>
            </div>
          </div>
        )
      }
    />
  );
}

/** Documents filed in SharePoint and linked to the record (signed bids, contract, photos). */
function LinkedDocs({ p, canEdit, add, by }: { p: Procurement; canEdit: boolean; add: (l: DocLink) => void; by: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const links = p.links ?? [];
  const ok = title.trim().length >= 2 && isSharePointUrl(url);
  return (
    <div className="mt-4">
      <SectionLabel>Linked from SharePoint · {links.length}</SectionLabel>
      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map((l) => (
            <li key={l.url} className="text-sm">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest hover:underline">
                {l.title} <span aria-hidden>↗</span>
              </a>
              <span className="block text-xs text-muted">
                {stepById[l.step]?.title ?? l.step} · {l.by}, {l.date}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (open ? (
          <div className="mt-2 space-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
            <input className="w-full rounded-lg border border-line bg-paper px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What it is: signed bid from Vision Supply" aria-label="Document title" />
            <input className="w-full rounded-lg border border-line bg-paper px-3 py-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://rootsofpeace.sharepoint.com/…" aria-label="SharePoint link" inputMode="url" />
            {url && !isSharePointUrl(url) && <p className="text-xs text-clay">That is not a SharePoint link: open the file in SharePoint and use Copy link.</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className={primaryBtn}
                disabled={!ok}
                onClick={() => {
                  add({ title: title.trim(), url: url.trim(), step: p.step, by, date: today() });
                  setTitle("");
                  setUrl("");
                  setOpen(false);
                }}
              >
                Link document
              </button>
              <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mt-2 text-sm font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>
            + Link a document in SharePoint
          </button>
        ))}
    </div>
  );
}
