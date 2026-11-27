"use client";

import { AnyLinkCaution } from "@/components/app/any-link-caution";
import { askReason } from "@/components/app/dialogs";
import { Arrow } from "@/components/app/arrow";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDefaultRole } from "@/components/app/use-default-role";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { isFileLink, storeNames } from "@/lib/file-store";
import { useT } from "@/components/app/i18n";
import { SelfConfirmSheet, useSolo } from "@/components/app/self-confirm";
import { useDonors, usePlan, useProcurements } from "@/components/app/use-project-data";
import type { BudgetLine as ProjectBudgetLine, WorkplanItem } from "@/lib/budget";
import { METHOD, openAsks, toUsd, type PlanItem } from "@/lib/procurement-plan";
import { activityHref, resultHref, workplanOfProcurement } from "@/lib/connections";
import { isProcurementManager } from "@/lib/procurement-plan";
import { AiCheck, DraftPanel, RoutePicker, SoleFacts, SupplierField, VoucherPanel, type DraftKind } from "@/components/procurement/route-panels";
import { useSupplierRegister, type SupplierRow } from "@/components/procurement/suppliers-page";
import { BidsPanel, DistributionPanel } from "@/components/procurement/bid-panels";
import { DocumentViewer } from "@/components/procurement/document";
import { PurchaseBooks } from "@/components/procurement/purchase-books";
import { PaidPanel, PayFormPanel, PayFormSummary, PaymentsList, ReceiptPanel, SchedulePanel } from "@/components/procurement/payment-panels";
import { asPaid, orderUsd, type PaymentRecord } from "@/lib/payments";
import type { VoucherSetup } from "@/lib/voucher-setup";
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
  StepCard,
  Tracker,
  primaryBtn,
  stickyActions,
  quietBtn,
  StatusPill,
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
  levelText,
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
  stageLabels,
  stepById,
  stepsFor,
  actionFor,
  valueOf,
  type Issue,
  type Procurement,
  type Role,
  maySign,
  procRolesFor,
  typeFor,
  setLineMoney,
  setProcurementSet,
  setSupplierRegister,
  receivedQty,
  type DocLink,
  requesterOf,
  soloBarred,
  voucherBarred,
} from "@/lib/procurement";
import { holdersOfType } from "@/lib/authority";
import { ROLE_LABEL } from "@/lib/hr";
import { today } from "@/lib/clock";
import { DoubleRule, Empty, Fig, Figures, LedgerRow, LedgerTable, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";


const fieldCls = "min-h-11 w-full border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";
// A link in the queue's ruled list (calendar, suppliers, register): one ruled row each, 44px or more.
const queueLink = "flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-forest hover:bg-ochre-soft focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
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
            // A step with no past cases has no median to quote: left out, never shown as "undefined" (review round 1, ISS-26).
            .filter((x) => stepHistory[x.step])
            .map((x) => `${stepById[x.step].title}: median ${stepHistory[x.step].median} days (${stepHistory[x.step].n} cases)`)
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
    <div className="border-b border-line px-5 py-5 font-ledger">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="border-s-[6px] border-ochre ps-2 text-lg font-bold leading-tight text-ink">Requisition details</p>
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
        {p.plan ? (
          <p className="flex items-end pb-2 text-sm text-muted">
            <span>
              From procurement calendar <span className="font-mono">{p.plan.key}</span>
            </span>
          </p>
        ) : (
          <label className="flex min-h-11 items-end gap-2 pb-2 text-sm">
            <input id="rq-urgent" type="checkbox" disabled={!editable} checked={p.urgent} onChange={(e) => set({ urgent: e.target.checked })} className="h-4 w-4 accent-[var(--forest)]" />
            Urgent (not in the procurement plan)
          </label>
        )}
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
      <p className="mt-4 border-t border-ink pt-2 text-sm text-muted">
        Estimated total <Fig strong className="text-ink">{money(valueOf(p))}</Fig> · {levelFor(valueOf(p))} level
        {line && (
          <>
            {" "}
            · <Fig>{money(line.remainingValue)}</Fig> left on <span className="font-mono">{line.code}</span>
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
          urgent: item ? !!item.unplanned?.urgent : urgent,
          step: "need",
          checks: {},
          issues: [],
          timeline: [{ date: today(), who: "holder", what: (item ? `Request created from procurement calendar ${item.key}${item.unplanned ? ` (not planned: ${item.unplanned.reason})` : ""}` : "Request created") + (grant ? ` for grant ${grant.id} (${grant.business})` : "") }],
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
                  ...(item.unplanned ? { unplanned: { by: item.unplanned.name, at: item.unplanned.at, reason: item.unplanned.reason, urgent: item.unplanned.urgent } } : {}),
                  approvedBy: [item.approvals.manager, item.approvals.lead].filter((a): a is NonNullable<typeof a> => !!a).map((a) => (a.for ? `${a.name} for ${a.for}` : a.name)),
                },
              }
            : {}),
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <header className="font-ledger">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-warn">
          {item ? `Procurement request · ${item.key}` : "New request"}
          {grant ? ` · for grant ${grant.id}, ${grant.business}` : ""}
        </p>
        <h2 className="mt-1 text-4xl font-bold leading-none tracking-tight text-ink">{item ? "Check and complete the request" : "What do you need?"}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {item
            ? "Filled in from the approved procurement calendar. Check every field, add the specification and where it is delivered, then create it. You will review the generated document and sign it in the next steps."
            : "This starts the purchase requisition. You will finish it, review the generated document and sign it in the next steps."}
        </p>
        <DoubleRule className="mt-4" />
      </header>
      {item && from && (
        <section className="text-sm">
          <SectionHead className="mt-0">From the plan</SectionHead>
          <dl className="mt-3 border-t border-ink font-ledger [&>div:last-child]:border-ink">
            <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Budget line</dt>
              <dd>
                <span className="font-mono text-xs">{item.budgetCode}</span> {from.line?.description ?? item.title}
                {from.line && (
                  <span className="block font-mono text-xs tabular-nums text-muted">
                    {from.line.quantity !== null ? `${from.line.quantity} ${from.line.unit ?? ""} · ` : ""}
                    {from.line.spent ? "partly spent · " : ""}
                    {item.value.toLocaleString("en-US")} {item.currency} left
                  </span>
                )}
              </dd>
            </div>
            {from.line?.activity && (
              <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted">Activity</dt>
                <dd>
                  <span className="font-mono text-xs">{from.line.activityCode}</span> {from.line.activity}
                </dd>
              </div>
            )}
            {from.wp && (
              <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted">Workplan</dt>
                <dd>
                  <span className="font-mono text-xs">{from.wp.code}</span> {from.wp.title}
                  {from.wp.indicator && <span className="block text-xs text-muted">{from.wp.indicator}</span>}
                </dd>
              </div>
            )}
            <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">How it is bought</dt>
              <dd>
                {/* The method follows this request's value; the calendar's estimate may have been for more. */}
                {(() => {
                  const lvl = value > 0 ? levelFor(value) : item.level;
                  return (
                    <>
                      {METHOD[lvl].title} <span className="text-xs text-muted">({lvl}{lvl !== item.level ? `; the calendar estimated ${item.level}` : ""})</span>
                    </>
                  );
                })()}
              </dd>
            </div>
            <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Needed by</dt>
              <dd>
                <span className="font-mono tabular-nums">{date(item.neededBy, { day: "numeric", month: "short", year: "numeric" })}</span> <span className="text-xs text-muted">{item.neededWhy}</span>
              </dd>
            </div>
            <div className="grid gap-x-4 gap-y-0.5 border-b border-line px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Approved by</dt>
              <dd>{[item.approvals.manager, item.approvals.lead].filter(Boolean).map((a) => a!.name + (a!.for ? ` for ${a!.for}` : "")).join(" and ")}</dd>
            </div>
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
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input id="nr-urgent" type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
            Urgent (not in the procurement plan)
          </label>
        )}
      </div>
      <Figures
        className="mt-0"
        items={[
          { label: "Estimated value", value: money(value) },
          { label: "Level", value: value > 0 ? levelFor(value) : "—" },
          { label: "Left on line", value: money(bl.remainingValue), tone: value > bl.remainingValue ? "clay" : undefined },
        ]}
      />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={!valid} className={`${primaryBtn} min-h-11`}>
          Create request
        </button>
        {item && !valid && <span className="self-center text-xs text-muted">Add the specification and delivery place to continue.</span>}
        <button type="button" onClick={onCancel} className="min-h-11 rounded-sm px-4 py-3 text-sm text-muted hover:text-ink">
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
  viaField = false,
  coding,
}: {
  /** The project's voucher coding from setup (lib/voucher-setup): a new voucher starts from it. */
  coding?: VoucherSetup | null;
  register?: SupplierRow[] | null;
  /** Its goods are in the Field input package: handed out farmer by farmer in Field activities. */
  viaField?: boolean;
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
  // Nor does the voucher's preparer review or approve it (lib/procurement voucherBarred).
  const voucherBar = voucherBarred(p, user?.name);
  const mine = !!role && owner === role && maySign(user, p, role) && !checkedBySelf && !voucherBar;
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
  // The step's checks with their state, and the first one still to do (the shaded row); the document review comes last.
  const checkRows = p.step === DONE ? [] : (step?.checks ?? []).map((c) => ({ c, s: checkState(p, c, money) }));
  const firstOpen = checkRows.findIndex((x) => !x.s.ok);
  const goldRow = firstOpen >= 0 ? firstOpen : step?.signs && !reviewed ? checkRows.length : -1;

  const log = (q: Procurement, what: string): Procurement => ({ ...q, timeline: [...q.timeline, { date: today(), who: role ?? "procurement", what, ...(user ? { by: user.name } : {}) }] });

  const complete = (self?: { note: string }) =>
    update((q) => {
      const s = stepById[q.step];
      return log(completeStep(q, { name: user?.name ?? roleLabel(s.owner), date: today(), ...(self ? { self } : {}) }), s.signs ? `${s.done} · signed ${s.signs.doc.toLowerCase()}${self ? " (self-approved, solo mode)" : ""}` : s.done);
    });

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      <header className="font-ledger">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink">{p.id}</span>
          <Pill tone="muted">{levelText(levelFor(value))}</Pill>
          {p.urgent && <Pill tone="clay">Urgent</Pill>}
          {p.feeds && <Pill tone="sky">Feeds field inputs</Pill>}
          {p.grant && links && (
            <Link href={`/work/grants?project=${encodeURIComponent(links.project)}&open=${p.grant}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-forest hover:underline">
              For grant <span className="ms-1 font-mono">{p.grant}</span>
            </Link>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
          <h2 className="min-w-0 flex-1 text-4xl font-bold leading-none tracking-tight text-ink">{p.title}</h2>
          <p className="font-mono text-sm font-bold tabular-nums text-ink">{money(orderUsd(p))}</p>
        </div>
        {links?.activity && (
          <Link href={activityHref(links.project, links.activity.code)} className="mt-1 flex min-h-11 items-center text-sm text-forest hover:underline">
            <span>
              For <span className="font-mono">{links.activity.code}</span> {links.activity.title.slice(0, 80)}
            </span>
          </Link>
        )}
        <DoubleRule className="mt-3" />
        <dl className="text-sm [&>div:last-child]:border-ink">
          {(
            [
              ["Quantity", <span key="v" className="font-mono tabular-nums">{`${p.qty.toLocaleString("en-US")} ${p.unit}`}</span>],
              // Once a quotation is chosen or a contract signed, that is the value; the estimate stays beside it.
              orderUsd(p) !== value
                ? ["Order value", <span key="v" className="font-mono tabular-nums">{`${money(orderUsd(p))} (estimate ${money(value)})`}</span>]
                : ["Value", <span key="v" className="font-mono tabular-nums">{money(value)}</span>],
              [
                "Budget line",
                line ? (
                  <span key="v">
                    <span className="font-mono">{line.code}</span> {line.name}
                  </span>
                ) : (
                  <span key="v" className="font-mono">{p.budgetLine}</span>
                ),
              ],
              ["Needed by", <span key="v" className="font-mono tabular-nums">{p.neededBy}</span>],
              ...(p.supplier ? [["Supplier", p.supplier.name]] : []),
            ] as [string, React.ReactNode][]
          ).map(([k, v]) => (
            <div key={k} className="grid min-h-11 grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="border-b border-line px-1 py-4">
        <Tracker labels={stageLabels} current={p.step === DONE ? stages.length : step.stage} skipped={stages.map((_, i) => i).filter((i) => !stepsFor(p).some((s) => s.stage === i))} />
      </div>

      {p.step === DONE ? (
        <Sheet className="mt-0 font-ledger">
          <StatusBlock tone="forest">Closed</StatusBlock>
          <p className="mt-2 text-sm text-muted">
            The file is complete and every document carries <span className="font-mono">{p.id}</span>.
          </p>
        </Sheet>
      ) : (
        <>
          {checkedBySelf && <p className="bg-ochre-soft px-4 py-3 text-sm text-warn">You checked this payment, so another Finance person verifies it.</p>}
          {needsOther && (
            <p className="bg-ochre-soft px-4 py-3 text-sm text-warn">
              This signature needs the {ROLE_LABEL[needsOther].toLowerCase()} ({holdersOfType(needsOther).map((id) => userById(id)?.name ?? id).join(" or ") || "nobody named in the authority table"}):{" "}
              {needsOther === "ceo" ? "large awards and every sole source go to the executive head." : "it is outside your role."}
            </p>
          )}
        <StepCard
          mine={mine}
          ownerLabel={rolePersonFor(p, owner!)}
          info={step.gate ? `In the procurement policy this step is sign-off point ${step.gate} ("gate ${step.gate}"): the purchase cannot go further until it is signed.` : undefined}
          title={step.title}
          note={step.note}
          onViewAs={ownerUser && mode === "demo" ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? `Sign in as ${ownerUser.name.split(" ")[0]} (demo)` : undefined}
          footer={
            <>
              {mine && (
                <div className={stickyActions}>
                  {blocks.length > 0 && (
                    <p className="text-sm font-medium text-clay">{blocks.length === 1 ? "An open issue is" : `${blocks.length} open issues are`} holding this step.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {ownApproval && !mayOwn ? (
                      <p className="text-sm text-warn">The person who requested a purchase cannot approve it, so someone else signs here.{ownBarred && solo ? ` ${ownBarred}` : ""}</p>
                    ) : (
                      <button type="button" disabled={!isReady} onClick={() => (mayOwn ? setSelfing(true) : complete())} className={`${primaryBtn} min-h-11`}>
                        {step.signs && !/\bsign\b/i.test(actionFor(p, step)) ? `Sign and ${lowerFirst(actionFor(p, step))}` : actionFor(p, step)} <Arrow />
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
                      <button type="button" onClick={() => setReturning(true)} className="min-h-11 rounded-sm border border-line px-4 py-3 text-sm font-medium hover:border-clay hover:text-clay">
                        Return with comments
                      </button>
                    )}
                    {raising === null && (
                      <button type="button" onClick={() => setRaising("")} className="min-h-11 rounded-sm px-2 py-2 text-sm font-medium text-muted hover:text-ink sm:px-4 sm:py-3">
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
                        className="min-h-11 min-w-0 flex-1 border border-line bg-surface px-3 py-2 text-sm focus:border-clay focus:outline-none"
                      />
                      <button type="submit" className="min-h-11 rounded-sm bg-clay px-4 py-2 text-sm font-medium text-white">
                        Return
                      </button>
                      <button type="button" onClick={() => setReturning(false)} className="min-h-11 px-2 text-sm text-muted">
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
          {(p.step === "payReady" || p.step === "approvePay" || p.step === "voucher" || p.step === "voucherReview" || p.step === "voucherApprove") && <PayFormSummary p={p} />}
          {p.step === "paid" && <PaidPanel p={p} editable={mine} update={update} />}
          {user && (receivedQty(p) > 0 || p.distribution) && <DistributionPanel p={p} viaField={viaField} resultLink={links ? (people) => resultHref(links.project, { from: p.id, ...people, note: `${p.id}: ${p.title} handed to ${people.value} people (${people.female} women)${people.place ? ` at ${people.place}` : ""}, from signed distribution lists.` }) : undefined} canEdit={user.procurementAccess === "edit"} update={update} me={{ id: user.id, name: user.name }} />}
          {(p.step === "voucher" || p.step === "voucherReview" || p.step === "voucherApprove") && (
            <VoucherPanel p={p} editable={mine} update={update} coding={coding} preparedByMe={!!user && (p.signatures["Expense voucher"] ?? []).some((x) => x.as === "Prepared and entered by (finance)" && x.name === user.name)} />
          )}
          {step.checks.some((c) => c.ai) && <AiCheck p={p} editable={mine} onCheck={onCheck} />}
          {(checkRows.length > 0 || step.signs) && (
            <LedgerTable className="mt-0 px-2 py-3 sm:px-3" cols="minmax(0,1fr)" head={["What this step needs"]} label={`${step.title}: checks`}>
              {checkRows.map(({ c, s }, i) => (
                <LedgerRow key={c.id} cols="minmax(0,1fr)" n={i + 1} first={i === goldRow} className="[&>ul>li]:py-0">
                  <ul className="min-w-0">
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
                      onResolve={async () => {
                        // Overriding an automatic check always says why, and where any memo is filed.
                        const why = await askReason({
                          message: `${c.resolve}. Say why, and paste the ${storeNames()} link to the memo if there is one.`,
                          placeholder: "e.g. Only two suppliers sell this in the district. Memo: https://rootsofpeace.sharepoint.com/...",
                          confirm: c.resolve!,
                          min: 10,
                        });
                        if (!why) return;
                        update((q) =>
                          log(
                            { ...q, checks: { ...q.checks, [`fix.${q.step}.${c.id}`]: true }, overrides: { ...q.overrides, [`fix.${q.step}.${c.id}`]: { why, by: user?.name ?? "", date: today() } } },
                            `${c.resolve}: ${why}`,
                          ),
                        );
                      }}
                    />
                  </ul>
                  {/* An override a second person confirms (ISS-17): the procurement manager, not whoever recorded it. */}
                  {(() => {
                    const key = `fix.${p.step}.${c.id}`;
                    const o = p.overrides?.[key];
                    if (!c.second || !p.checks[key] || !o || o.confirmedBy) return null;
                    const may = !!user && user.name !== o.by && (!!user.admin || isProcurementManager(user));
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-2 bg-ochre-soft px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">{`Waiting for ${c.second} to confirm: ${o.why} (${o.by}).`}</span>
                        {may && (
                          <button type="button" className={`${quietBtn} min-h-11`} onClick={() => update((q) => log({ ...q, overrides: { ...q.overrides, [key]: { ...o, confirmedBy: { name: user!.name, date: today() } } } }, `${c.resolve}: confirmed by ${user!.name}`))}>
                            Confirm: {c.resolve?.toLowerCase()}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </LedgerRow>
              ))}
              {step.signs && (
                <LedgerRow cols="minmax(0,1fr)" n={checkRows.length + 1} first={goldRow === checkRows.length}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-xs font-bold text-white ${reviewed ? "bg-leaf" : "bg-line"}`}>{reviewed ? "✓" : ""}</span>
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug">Review the generated {step.signs.doc.toLowerCase()}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {reviewed ? `Reviewed. You sign as “${step.signs.as}” when you continue.` : `You sign it as “${step.signs.as}” when you continue.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewing({ doc: step.signs!.doc, confirm: mine })}
                      className={`min-h-11 shrink-0 rounded-sm px-4 py-2 text-sm font-semibold transition ${reviewed || !mine ? "border border-line hover:border-forest hover:text-forest" : "bg-forest text-forest-ink"}`}
                    >
                      {reviewed || !mine ? "Open" : "Review document"}
                    </button>
                  </div>
                </LedgerRow>
              )}
            </LedgerTable>
          )}
          {goldRow >= 0 && <p className="px-5 pb-3 text-xs text-muted">The shaded row is the first item still to do.</p>}
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
      <PurchaseBooks code={current.id} purchase={p.id} paid={(p.payments ?? []).length} user={user?.id} />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="min-w-0">
          <SectionHead className="mt-0" aside={<Fig tone="muted">{docs.length} documents</Fig>}>
            File
          </SectionHead>
          {docs.length === 0 ? (
            <Empty>Documents appear here as each step completes.</Empty>
          ) : (
            <LedgerTable cols="minmax(0,1fr) 4rem" head={["Document", { label: "Signed", end: true }]} label={`File · ${docs.length} documents`}>
              {docs.map((d, i) => {
                const signed = p.signatures[d]?.length ?? 0;
                return (
                  <LedgerRow key={d} cols="minmax(0,1fr) 4rem" n={i + 1} onClick={() => setViewing({ doc: d, confirm: false })} className="text-sm">
                    <span className="min-w-0 truncate font-medium text-forest">{d}</span>
                    <Fig tone={signed > 0 ? "forest" : "muted"}>{signed > 0 ? `✍ ${signed}` : ""}</Fig>
                  </LedgerRow>
                );
              })}
            </LedgerTable>
          )}
          <p className="mt-3 text-xs text-muted">Every document is generated from this record and filed under {p.id}.</p>
          <LinkedDocs p={p} canEdit={!!user && (user.procurementAccess === "edit" || !!user.admin)} add={(l) => update((q) => log({ ...q, links: [...(q.links ?? []), l] }, `Linked ${l.title} from ${storeNames()}`))} by={user?.name ?? ""} />
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
  const { items, packageLines, coding, setItems, status, error, reset, draft: draftDoc, check: runCheck } = useProcurements(project.id);
  const plan = usePlan(project.saved ? project.id : null);
  const donors = useDonors(project.id);
  const [planKey, setPlanKey] = useState<string | null>(null);
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
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { money, mode } = useSession();

  // Checks that look across procurements (split purchases) read the whole project's list.
  setProcurementSet(items);
  // The budget lines' live money and the calendar's open asks: the one figure for what is left on a line (lib/line-money).
  setLineMoney(
    plan.budget?.lines.length
      ? plan.budget.lines.map((l) => ({
          code: l.code,
          budgetUsd: toUsd(l.total, plan.budget!.currency),
          spentUsd: toUsd(l.spent ?? 0, plan.budget!.currency),
          asks: openAsks(plan.items).filter((a) => a.code === l.code).map((a) => ({ key: a.key, usd: toUsd(a.value, a.currency) })),
        }))
      : null,
  );
  // On a real project the supplier checks read the supplier register.
  const register = useSupplierRegister(!!project.saved && project.id !== "A-2027", user?.id);
  setSupplierRegister(register);
  const counts = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, items.filter((p) => ownerOf(p) === r.id).length])), [items]);
  // Open on the first of the person's roles with something waiting, chosen once when the list loads.
  const role = useDefaultRole(myRoles, counts, status === "ready", project.id, pickedRole);
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
            <ul className="mx-4 mt-3 border-t border-ink font-ledger sm:mx-6 [&>li:last-child]:border-ink">
              <li className="border-b border-line">
                <Link href="/work/plan" className={queueLink}>
                  Procurement calendar
                  <Arrow />
                </Link>
              </li>
              <li className="border-b border-line">
                <Link href="/work/suppliers" className={queueLink}>
                  Suppliers
                  <Arrow />
                </Link>
              </li>
              <li className="border-b border-line">
                <Link href="/work/register" className={queueLink}>
                  Procurement register and monthly report
                  <Arrow />
                </Link>
              </li>
              <li className="border-b border-line">
                <Link href="/work/bills" className={queueLink}>
                  Bills paid directly (rent, utilities, insurance)
                  <Arrow />
                </Link>
              </li>
              {(myRoles.includes("finance") || user.admin) && (
                <li className="border-b border-line">
                  <Link href="/work/closeout" className={queueLink}>
                    Month close
                    <Arrow />
                  </Link>
                </li>
              )}
            </ul>
          )}
          <QueueHeader
            title={status === "loading" ? "Loading…" : readOnly || showAll ? "All procurements" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            toggleLabel={readOnly ? "" : showAll ? "Mine" : "Show all"}
            onToggle={() => setShowAll(!showAll)}
          />
          {list.length === 0 ? (
            <EmptyQueue loading={status === "loading"} onShowAll={() => setShowAll(true)} />
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
                      <span className="font-mono text-xs text-muted">{p.id}</span>
                      <span className="text-xs tabular-nums text-muted">{money(orderUsd(p))}</span>
                    </div>
                    <p className="mt-1 font-medium leading-snug">{p.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {p.step === DONE ? (
                        <StatusPill tone="forest">Closed</StatusPill>
                      ) : (
                        <Pill tone={o === role ? "forest" : "muted"}>
                          {s.title}
                        </Pill>
                      )}
                      {blockingIssues(p).length > 0 && <Pill tone="clay">Issue</Pill>}
                      {late && <Pill tone="ochre">Past needed-by</Pill>}
                      {(showAll || readOnly) && o && o !== role && <span className="text-xs text-muted">{holderFor(p, o)?.name}</span>}
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
          {error && (
            <p role="alert" className="px-4 pt-3 text-sm text-clay sm:px-6">
              {error}
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
            <div className="mx-auto max-w-xl py-16 text-sm">
              <header className="font-ledger">
                <h2 className="text-3xl font-bold leading-none tracking-tight text-ink">Start from the procurement calendar</h2>
                <p className="mt-2 text-muted">On this project every request charges an approved calendar item, so it carries the real budget line and the money left on it.</p>
                <DoubleRule className="mt-4" />
              </header>
              <Link href="/work/plan" className={`${primaryBtn} mt-4 inline-flex min-h-11 items-center`}>
                Open the procurement calendar
              </Link>
              <Link href="/work/plan?ask=1" className="mt-4 flex min-h-11 items-center border-y border-line px-1 font-semibold text-forest hover:bg-ochre-soft">
                Not on the calendar? Ask for it here
              </Link>
              <p className="mt-1 text-xs text-muted">Unplanned or urgent purchases go on the calendar marked as not planned, and are approved the same way before the request starts.</p>
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
            onCreate={async (draft) => {
              // The project's next free number, with its code in it (PR-A2027-004), asked of the server
              // (review round 1, ISS-11). A project not saved yet numbers its own the same way.
              const tag = project.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
              const num = (x: string) => Number(x.match(new RegExp(`^PR-${tag}-(\\d+)$`))?.[1] ?? 0);
              let id = `PR-${tag}-${String(Math.max(0, ...items.map((x) => num(x.id))) + 1).padStart(3, "0")}`;
              if (project.saved && user) {
                try {
                  const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/procurements/next-id`, { cache: "no-store", headers: { "x-demo-user": user.id } });
                  const next = r.ok ? ((await r.json()) as { id?: string }).id : undefined;
                  // Never a number below one already on this screen (a request made a moment ago, not saved yet).
                  if (next && !items.some((x) => x.id === next) && num(next) > num(id)) id = next;
                } catch {
                  // Offline or the server is busy: the save takes the number and says so if it is taken.
                }
              }
              const p = { ...draft, id };
              setItems((all) => [p, ...all]);
              setSelected(p.id);
              setCreating(false);
              // The server starts the calendar item with the save (api/projects/[code]/procurements).
              setPlanKey(null);
              setGrantId(null);
              setForGrant(null);
            }}
          />
          )
          )
        ) : current ? (
          <div className="mx-auto max-w-3xl">
            <Detail key={current.id} register={register} p={current} coding={coding} viaField={packageLines.includes(current.budgetLine)} links={{ project: project.id, activity: activityOf(current) }} role={role} update={update(current.id)} onBack={() => setMobileDetail(false)} onDraft={(kind) => draftDoc(current.id, kind)} onCheck={() => runCheck(current.id, current.step)} />
          </div>
        ) : (
          <div className="grid h-full place-items-center py-24 text-center">
            <div>
              <p className="font-ledger text-2xl font-bold text-ink">{status === "loading" ? "Loading…" : "Nothing selected"}</p>
              {status !== "loading" && <p className="mt-1 text-sm text-muted">Pick a procurement from the list, or start a new request.</p>}
            </div>
          </div>
        )
      }
    />
  );
}

/** Documents filed in the organization's file store and linked to the record (signed bids, contract, photos). */
function LinkedDocs({ p, canEdit, add, by }: { p: Procurement; canEdit: boolean; add: (l: DocLink) => void; by: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const links = p.links ?? [];
  // The organization's file stores, from the session, so this renders again when they arrive or change.
  const { fileStores } = useSession();
  const names = storeNames(fileStores.now);
  const isLink = (u: string) => isFileLink(u, fileStores.now);
  const ok = title.trim().length >= 2 && isLink(url);
  return (
    <div className="mt-8">
      <SectionHead className="mt-0" aside={<Fig tone="muted">{links.length}</Fig>}>
        Linked from {names}
      </SectionHead>
      {links.length > 0 && (
        <ul className="mt-3 border-t border-ink [&>li:last-child]:border-ink">
          {links.map((l) => (
            <li key={l.url} className="border-b border-line px-3 py-2 text-sm">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                <span>
                  {l.title} <span aria-hidden>↗</span>
                </span>
              </a>
              <span className="block text-xs text-muted">
                {stepById[l.step]?.title ?? l.step} · {l.by}, <span className="font-mono tabular-nums">{l.date}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (open ? (
          <Sheet className="mt-3 space-y-2 text-sm">
            <input className="min-h-11 w-full border border-line bg-paper px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What it is: signed bid from Vision Supply" aria-label="Document title" />
            <input className="min-h-11 w-full border border-line bg-paper px-3 py-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={`Link to the file in ${names}`} inputMode="url" />
            {url && !isLink(url) && <p className="text-xs text-clay">That is not a link to {names}: open the file there and copy its link.</p>}
            <AnyLinkCaution />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${primaryBtn} min-h-11`}
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
              <button type="button" className={`${quietBtn} min-h-11`} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </Sheet>
        ) : (
          <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>
            + Link a document in {names}
          </button>
        ))}
    </div>
  );
}
