"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { usePlan } from "@/components/app/use-project-data";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn, type Tone, StatusPill } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import type { BudgetLine, WorkplanItem } from "@/lib/budget";
import { canEditProject, userById, users, type AppUser } from "@/lib/demo";
import { LEAD_DAYS, METHOD, awaiting, canAsk, isManager, isProcurementManager, lineRoom, procurementManager, toUsd, type PlanItem, type PlanStatus } from "@/lib/procurement-plan";
import { lineFigureText } from "@/lib/line-money";
import { levelFor } from "@/lib/procurement";
import { today } from "@/lib/clock";

/**
 * Procurement calendar: every planned purchase from the budget, by the month it has to start.
 * Each item opens with the information needed to approve it: the budget line, the workplan
 * activity, how it will be bought and why the dates are what they are.
 */

const STATUS: Record<PlanStatus, { label: string; tone: Tone }> = {
  draft: { label: "Awaiting approval", tone: "ochre" },
  approved: { label: "Approved", tone: "forest" },
  returned: { label: "Sent back", tone: "clay" },
  started: { label: "Started", tone: "sky" },
};
const LEVEL_TONE: Record<PlanItem["level"], Tone> = { Micro: "muted", Small: "sky", Medium: "plum", Large: "clay" };

type Filter = "all" | "mine" | PlanStatus;
// The month lists: the purchase, then its value, size, status and start date at the right.
const LIST_COLS = "minmax(0,1fr) 12rem";

export function ProcurementPlanPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const plan = usePlan(project.saved ? project.id : null);
  const { date } = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  // On a phone the details sit below the list: bring them into view when a purchase is opened.
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && window.matchMedia("(max-width: 1023px)").matches) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  // Links such as /work/plan?open=PP-003, ?filter=mine or ?ask=1 (ask for something not on the calendar).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("open")) setOpen(q.get("open"));
    if (q.get("ask")) setAsking(true);
    const f = q.get("filter");
    if (f === "mine" || f === "approved" || f === "draft" || f === "returned" || f === "started") setFilter(f);
  }, []);

  const money = useMemo(() => {
    const currency = plan.budget?.currency ?? "USD";
    try {
      const f = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
      return (n: number) => f.format(n);
    } catch {
      return (n: number) => `${Math.round(n).toLocaleString("en-US")} ${currency}`;
    }
  }, [plan.budget?.currency]);

  if (!user) return null;
  if (user.kind !== "employee" || user.procurementAccess === "none")
    return (
      <Shell>
        <p className="py-24 text-center text-muted">Procurement is for staff with procurement access.</p>
      </Shell>
    );
  if (!project.saved)
    return (
      <Shell>
        <p className="py-24 text-center text-muted">This project has no budget in the database. Pick a project created in setup.</p>
      </Shell>
    );

  const mine = awaiting(plan.items, user);
  const mineKeys = new Set([...mine.asManager, ...mine.asLead].map((i) => i.key));
  const shown = plan.items.filter((i) => (filter === "all" ? true : filter === "mine" ? mineKeys.has(i.key) || (i.status === "approved" && i.techLead === user.id) : i.status === filter));
  const months = [...new Set(shown.map((i) => i.startBy.slice(0, 7)))];
  // Look first at the purchase furthest past the day it had to start.
  const lateFirst = shown.filter((i) => i.startBy < today() && i.status !== "started").sort((a, b) => a.startBy.localeCompare(b.startBy))[0]?.key;
  const current = plan.items.find((i) => i.key === open) ?? null;
  const canBuild = isManager(user) || canEditProject(user) || !!user.admin;
  const mayAsk = canAsk(user) && !!plan.budget?.lines.length;
  const total = plan.items.reduce((s, i) => s + i.value, 0);
  const count = (s: PlanStatus) => plan.items.filter((i) => i.status === s).length;

  const rebuild = async () => {
    setBusy(true);
    try {
      const r = await plan.rebuild();
      setNote(
        r.total
          ? `Calendar updated from the budget: ${r.total} ${r.total === 1 ? "item" : "items"} (${r.added} new${r.removed ? `, ${r.removed} removed` : ""}). Items already approved or changed by someone were kept.`
          : "Nothing to add: no budget line is marked to procure.",
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageHead
        kicker={project.name}
        title="Procurement calendar"
        actions={
          <>
            {mayAsk && !asking && (
              <button type="button" onClick={() => setAsking(true)} className={quietBtn}>
                Ask for something not on the calendar
              </button>
            )}
            <Link href="/work?source=procurement" className={quietBtn}>
              Procurements in progress
            </Link>
            {canBuild && (
              <button type="button" onClick={() => void rebuild()} disabled={busy} className={primaryBtn}>
                {busy ? "Updating…" : plan.items.length ? "Update from budget" : "Build from budget"}
              </button>
            )}
          </>
        }
      >
        Built from the budget lines marked to procure. The procurement manager and each line&apos;s technical lead approve it; approved purchases go on the Tasks calendar on the day they have to start.
      </PageHead>
      {note && (
        <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm">
          {note}
        </p>
      )}
      {plan.error && (
        <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
          {plan.error}
        </p>
      )}
      {asking && canAsk(user) && plan.budget && (
        <AskForm
          lines={plan.budget.lines}
          items={plan.items}
          committed={plan.committed}
          currency={plan.budget.currency}
          money={money}
          onAsk={plan.ask}
          onCancel={() => setAsking(false)}
          onDone={(item) => {
            setAsking(false);
            setFilter("all");
            setOpen(item.key);
            setNote(`${item.title} is on the calendar as ${item.key}${item.unplanned?.urgent ? ", marked urgent" : ""}. The procurement manager and the technical lead approve it like any other purchase; then the request can start.${item.unplanned?.overPlan ? ` Note: ${item.unplanned.overPlan}` : ""}`);
          }}
        />
      )}

      {canBuild && plan.budget && plan.budget.lines.length > 0 && (
        <Sheet className="mt-6">
          <details open={!plan.budget.lines.some((l) => l.procure)}>
            <summary className="flex min-h-11 cursor-pointer items-center font-ledger text-lg font-bold">
              Budget lines to buy&nbsp;<span className="font-mono text-sm font-normal text-muted">· {plan.budget.lines.filter((l) => l.procure).length} of {plan.budget.lines.length} marked</span>
            </summary>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              Tick the lines bought through procurement; staff time, fees and charges are not. This moves no money, so it is not a plan change for the monthly review; each change is kept in the audit trail. Then press {plan.items.length ? "Update from budget" : "Build from budget"}.
            </p>
            <ul className="mt-3 border-t border-ink text-sm [&>li:last-child]:border-ink">
              {plan.budget.lines.map((l) => (
                <li key={l.code} className="border-b border-line">
                  <label className="flex min-h-11 items-center gap-3 px-1 py-2">
                    <input
                      type="checkbox"
                      checked={l.procure}
                      disabled={busy}
                      onChange={async (e) => {
                        // Read before the save: by the time it returns the box has been drawn again.
                        const on = e.target.checked;
                        setBusy(true);
                        try {
                          await plan.markProcure({ [l.code]: on });
                          setNote(`${l.code} ${on ? "marked to buy" : "no longer marked to buy"}. Press ${plan.items.length ? "Update from budget" : "Build from budget"} to update the calendar.`);
                        } catch (err) {
                          setNote(err instanceof Error ? err.message : String(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="h-5 w-5 accent-forest"
                    />
                    <span className="w-20 font-mono text-xs">{l.code}</span>
                    <span className="min-w-0 flex-1">{l.description}</span>
                    <Fig tone="muted">{Math.round(l.total).toLocaleString("en-US")}</Fig>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        </Sheet>
      )}

      {plan.status === "loading" ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : !plan.items.length ? (
        <Empty className="mt-8">
          {plan.budget?.lines.length && !plan.budget.lines.some((l) => l.procure) ? (
            canBuild ? (
              <>None of the {plan.budget.lines.length} budget lines is marked to buy, so the calendar has nothing to plan. Tick the lines that are bought under &ldquo;Budget lines to buy&rdquo; below, then build the calendar.</>
            ) : (
              <>None of the {plan.budget.lines.length} budget lines is marked to buy yet. The project manager or the procurement manager marks them here, then builds the calendar.</>
            )
          ) : plan.budget?.lines.length ? (
            canBuild ? (
              "No calendar yet. Build it from the budget."
            ) : (
              "No calendar yet. The procurement manager builds it from the budget."
            )
          ) : (
            <>
              No budget yet. Upload it in{" "}
              <Link href="/setup?step=budget" className="font-semibold text-forest underline-offset-2 hover:underline">
                project setup
              </Link>
              .
            </>
          )}
        </Empty>
      ) : (
        <>
          <Figures
            className="mt-6"
            items={[
              { label: "Planned purchases", value: plan.items.length },
              { label: "Planned value", value: money(total) },
              { label: "Awaiting approval", value: count("draft") + count("returned") },
              { label: "Approved", value: count("approved") },
              { label: "Waiting on you", value: mineKeys.size, ...(mineKeys.size ? { tone: "clay" as const } : {}) },
            ]}
          />

          <div role="tablist" className="mt-4 flex flex-wrap gap-1">
            {(
              [
                ["all", "All"],
                ["mine", "Mine"],
                ["draft", "Awaiting approval"],
                ["returned", "Sent back"],
                ["approved", "Approved"],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`min-h-11 px-3 font-mono text-xs ${filter === f ? "font-bold text-ink underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-2 grid gap-6 lg:grid-cols-[1fr_minmax(0,26rem)]">
            <div className="min-w-0">
              {!shown.length && <Empty className="mt-4">Nothing here.</Empty>}
              {months.map((m, mi) => {
                const inMonth = shown.filter((i) => i.startBy.startsWith(m));
                return (
                  <section key={m} className="mb-6">
                    <SectionHead className={mi ? "mt-6" : "mt-4"}>Start in {date(`${m}-01`, { month: "long", year: "numeric" })}</SectionHead>
                    <LedgerTable cols={LIST_COLS} head={["Purchase", { label: "Value and status", end: true }]} label={`Start in ${date(`${m}-01`, { month: "long", year: "numeric" })}`}>
                      {inMonth.map((i) => {
                        const late = i.startBy < today() && i.status !== "started";
                        return (
                          <LedgerRow key={i.key} cols="minmax(0,1fr)" onClick={() => setOpen(i.key)} selected={open === i.key} current={open === i.key} first={i.key === lateFirst} className="text-sm">
                            <span className="flex flex-wrap items-start gap-x-3 gap-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_12rem]">
                              <span className="min-w-0 flex-1">
                                <span className="block font-bold leading-snug">{i.title}</span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                                  <span>{i.key}</span>
                                  <span>· {i.budgetCode}</span>
                                  <span>· {userById(i.techLead ?? "")?.name ?? "No technical lead"}</span>
                                </span>
                                {(mineKeys.has(i.key) || i.unplanned) && (
                                  <span className="mt-1 flex flex-wrap items-center gap-1">
                                    {mineKeys.has(i.key) && <StatusBlock tone="clay">Waiting on you</StatusBlock>}
                                    {i.unplanned && <Pill tone="plum">Not planned</Pill>}
                                    {i.unplanned?.urgent && <Pill tone="clay">Urgent</Pill>}
                                  </span>
                                )}
                              </span>
                              <span className="flex flex-col items-end gap-1 text-end">
                                <Fig strong>{money(i.value)}</Fig>
                                <span className="flex flex-wrap justify-end gap-1">
                                  <Pill tone={LEVEL_TONE[i.level]}>{i.level}</Pill>
                                  <StatusPill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusPill>
                                </span>
                                <span className={`block font-mono text-xs ${late ? "font-bold text-clay" : "text-muted"}`}>
                                  Start by {date(i.startBy)}
                                  {late ? " · late" : ""}
                                </span>
                              </span>
                            </span>
                          </LedgerRow>
                        );
                      })}
                    </LedgerTable>
                    {lateFirst && inMonth.some((i) => i.key === lateFirst) && <p className="mt-2 text-xs text-muted">The shaded row is the purchase furthest past its start date.</p>}
                  </section>
                );
              })}
            </div>
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
              {current ? (
                <div ref={detailRef} className="scroll-mt-20">
                <Detail
                  key={current.key}
                  item={current}
                  user={user}
                  line={plan.budget?.lines.find((l) => l.code === current.budgetCode) ?? null}
                  available={(() => {
                    const l = plan.budget?.lines.find((x) => x.code === current.budgetCode);
                    // An ask's own money is not taken off the figure it is measured against.
                    return l ? lineFigureText(lineRoom(l, plan.items, current.key, plan.committed[l.code] ?? 0).figure, money) : null;
                  })()}
                  wp={plan.workplan.find((w) => w.code === current.workplanCode && (!w.org || /rop|roots/i.test(w.org))) ?? plan.workplan.find((w) => w.code === current.workplanCode) ?? null}
                  workplan={plan.workplan}
                  money={money}
                  onAct={plan.act}
                  onClose={() => setOpen(null)}
                />
                </div>
              ) : (
                <Empty className="mt-4 hidden lg:block">Open a purchase to see what it is for, how it will be bought and who approves it.</Empty>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-line py-2 text-sm sm:grid-cols-[8rem_1fr]">
      <dt className="pt-0.5 font-mono text-xs text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Detail({
  item,
  user,
  line,
  available,
  wp,
  workplan,
  money,
  onAct,
  onClose,
}: {
  workplan: WorkplanItem[];
  item: PlanItem;
  user: AppUser;
  line: BudgetLine | null;
  /** The line's one figure in words, as the ask form and the requisition show it (lib/line-money). */
  available: string | null;
  wp: WorkplanItem | null;
  money: (n: number) => string;
  onAct: ReturnType<typeof usePlan>["act"];
  onClose: () => void;
}) {
  const { date } = useT();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [why, setWhy] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ neededBy: item.neededBy, leadDays: item.leadDays, techLead: item.techLead ?? "", workplanCode: item.workplanCode ?? "" });
  // The rows to choose from: this purchase's own activity first, then the rest of the workplan.
  const rows = [...workplan].sort((a, b) => Number(b.activityCode === item.activityCode) - Number(a.activityCode === item.activityCode) || a.code.localeCompare(b.code));
  const needsRow = workplan.length > 0 && !workplan.some((w) => w.code === item.workplanCode);

  const lead = userById(item.techLead ?? "");
  const manager = procurementManager(users);
  // Only the procurement manager approves for procurement; an administrator may sign for them.
  // Nobody approves what they asked for, in either seat (lib/procurement-plan OWN_REQUEST).
  const mine = item.unplanned?.by === user.id;
  const asManager = !mine && (isProcurementManager(user, users) || !!user.admin);
  const asLead = !mine && (user.id === item.techLead || !!user.admin);
  const canChange = (isManager(user) || user.id === item.techLead || !!user.admin) && item.status !== "approved" && item.status !== "started";
  const leads = users.filter((u) => u.leads?.length || u.procurement.includes("holder"));
  const method = METHOD[item.level];

  const run = async (a: Parameters<typeof onAct>[1]) => {
    setBusy(true);
    setError("");
    try {
      await onAct(item.key, a);
      setReturning(false);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signLine = (s: PlanItem["approvals"]["manager"], who: string) =>
    s ? (
      <span className="text-forest">
        ✓ {s.name}
        {s.for ? ` for ${s.for}` : ""}, {date(s.at)}
      </span>
    ) : (
      <span className="text-muted">Waiting for {who}</span>
    );

  return (
    <Sheet className="mt-4">
    <article aria-labelledby="plan-detail-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">
            {item.key} · {item.budgetCode}
          </p>
          <h2 id="plan-detail-title" className="mt-1 font-ledger text-2xl font-bold leading-tight">
            {item.title}
          </h2>
          <p className="mt-2 flex flex-wrap gap-1">
            <StatusPill tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusPill>
            <Pill tone={LEVEL_TONE[item.level]}>{item.level}</Pill>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center text-xl text-muted hover:bg-ochre-soft hover:text-ink">
          ×
        </button>
      </div>
      {item.returnNote && item.status === "returned" && <p className="mt-3 bg-clay-soft px-3 py-2 text-sm text-clay">Sent back: {item.returnNote}</p>}

      {item.unplanned && (
        <section className="mt-4 bg-plum-soft px-3 py-2 text-sm">
          <p className="font-semibold">
            Not on the calendar{item.unplanned.urgent ? " · urgent" : ""}
          </p>
          <p className="mt-1">{item.unplanned.reason}</p>
          <p className="mt-1 text-xs text-muted">
            Asked for by {item.unplanned.name}, {date(item.unplanned.at)}. It needs both approvals like any other purchase.
          </p>
          {item.unplanned.overPlan && <p className="mt-1 font-semibold text-clay">{item.unplanned.overPlan}</p>}
        </section>
      )}

      <section className="mt-5">
        <SectionLabel>What it is for</SectionLabel>
        <dl className="mt-1">
          <Row label="Budget line">
            {line ? (
              <>
                <span className="font-mono text-xs">{line.code}</span> {line.description}
              </>
            ) : (
              "Not in the budget any more"
            )}
          </Row>
          {line?.activity && (
            <Row label="Activity">
              {line.activityCode} {line.activity}
            </Row>
          )}
          <Row label="Workplan">
            {needsRow && canChange && <span className="mb-1 block bg-ochre-soft px-2 py-1 text-xs">No workplan row chosen. Choose one with the Change button before this can be approved.</span>}
            {wp && !item.workplanBy && item.status !== "started" && <span className="mb-1 block text-xs text-muted">Matched by the app from the budget line. Check it is the right row.</span>}
            {wp ? (
              <>
                <span className="font-mono text-xs">{wp.code}</span> {wp.title}
                {wp.start && (
                  <span className="block text-xs text-muted">
                    {wp.org ?? ""} · {date(wp.start)} – {wp.end ? date(wp.end) : "?"}
                    {wp.indicator ? ` · ${wp.indicator}` : ""}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted">No matching workplan row</span>
            )}
          </Row>
        </dl>
      </section>

      <section className="mt-4">
        <SectionLabel>Money</SectionLabel>
        <dl className="mt-1">
          <Row label="To buy">
            <span className="font-mono font-bold tabular-nums">{money(item.value)}</span> <span className="font-mono text-xs text-muted">≈ ${item.usd.toLocaleString("en-US")}</span>
          </Row>
          {line && (
            <Row label="Line budget">
              <span className="font-mono tabular-nums">{money(line.total)}</span>
              {line.spent ? <span className="block font-mono text-xs text-muted tabular-nums">{money(line.spent)} already spent</span> : null}
              {available && <span className="block text-xs text-muted">{available}</span>}
              {line.quantity !== null && (
                <span className="block text-xs text-muted">
                  {line.quantity} {line.unit ?? ""}
                  {line.unitCost !== null ? ` × ${money(line.unitCost)}` : ""}
                </span>
              )}
            </Row>
          )}
          {line && Object.keys(line.schedule).length > 0 && (
            <Row label="Budgeted in">
              {Object.entries(line.schedule)
                .sort()
                .map(([q, v]) => (
                  <span key={q} className="block font-mono text-xs tabular-nums">
                    {date(q, { month: "short", year: "numeric" })} quarter: {money(v)}
                  </span>
                ))}
            </Row>
          )}
        </dl>
        {!!line?.spent && (
          <p className="mt-2 bg-sunken px-3 py-2 text-xs text-muted">Part of this line is already spent. If an existing contract covers the rest (rent, internet, fuel), untick the line in the budget and it leaves the calendar.</p>
        )}
      </section>

      <section className="mt-4">
        <SectionLabel>How it will be bought</SectionLabel>
        <p className="mt-1 text-sm font-medium">{method.title}</p>
        <p className="text-sm text-muted">{method.detail}</p>
        <p className="mt-1 text-xs text-muted">A sole source or a different method can be chosen when the request is made.</p>
      </section>

      <section className="mt-4">
        <SectionLabel>Dates</SectionLabel>
        {editing ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Needed by
              <input type="date" value={draft.neededBy} onChange={(e) => setDraft({ ...draft, neededBy: e.target.value })} className="mt-1 block min-h-11 w-full border border-line bg-paper px-2" />
            </label>
            <label className="text-sm">
              Lead time (days)
              <input type="number" min={0} max={365} value={draft.leadDays} onChange={(e) => setDraft({ ...draft, leadDays: Number(e.target.value) })} className="mt-1 block min-h-11 w-full border border-line bg-paper px-2" />
            </label>
            {workplan.length > 0 && (
              <label className="text-sm sm:col-span-2">
                Workplan row this purchase serves
                <select value={draft.workplanCode} onChange={(e) => setDraft({ ...draft, workplanCode: e.target.value })} className="mt-1 block min-h-11 w-full border border-line bg-paper px-2">
                  <option value="">Not chosen</option>
                  {rows.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} {w.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm sm:col-span-2">
              Technical lead
              <select value={draft.techLead} onChange={(e) => setDraft({ ...draft, techLead: e.target.value })} className="mt-1 block min-h-11 w-full border border-line bg-paper px-2">
                <option value="">Not chosen</option>
                {leads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <dl className="mt-1">
            <Row label="Needed by">
              <span className="font-mono">{date(item.neededBy, { day: "numeric", month: "short", year: "numeric" })}</span>
              <span className="block text-xs text-muted">{item.neededWhy}</span>
            </Row>
            <Row label="Lead time"><span className="font-mono">{item.leadDays}</span> days (typical for {item.level.toLowerCase()} purchases)</Row>
            <Row label="Start by">
              <span className={`font-mono ${item.startBy < today() && item.status !== "started" ? "font-bold text-clay" : ""}`}>
                {date(item.startBy, { day: "numeric", month: "short", year: "numeric" })}
                {item.startBy < today() && item.status !== "started" ? " · late" : ""}
              </span>
            </Row>
          </dl>
        )}
      </section>

      <section className="mt-4">
        <SectionLabel>Approvals</SectionLabel>
        <dl className="mt-1">
          <Row label="Procurement">
            {manager?.name ?? "Procurement manager"}
            <span className="block text-xs">{signLine(item.approvals.manager, "approval")}</span>
          </Row>
          <Row label="Technical lead">
            {lead ? `${lead.name}, ${lead.title}` : <span className="text-clay">Not chosen</span>}
            <span className="block text-xs">{signLine(item.approvals.lead, "approval")}</span>
          </Row>
        </dl>
        {item.status === "approved" && <p className="mt-2 text-sm text-forest">On the Tasks calendar for {lead?.name ?? "the technical lead"} to start on {date(item.startBy)}.</p>}
        {item.status === "approved" && (user.id === item.techLead || mine || !!user.admin) && (
          <Link href={`/work?source=procurement&new=1&plan=${item.key}`} className={`${primaryBtn} mt-3 inline-block`}>
            {user.id === item.techLead || mine ? "Start the procurement request" : `Start the request for ${lead?.name ?? "the lead"}`}
          </Link>
        )}
        {item.status === "started" && item.procurementKey && (
          <p className="mt-2 text-sm">
            Request made:{" "}
            <Link href={`/work?source=procurement&open=${item.procurementKey}`} className="inline-flex min-h-11 items-center font-mono font-semibold text-forest hover:underline">
              {item.procurementKey}
            </Link>
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {returning ? (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="return-why">
            What needs to change?
          </label>
          <textarea id="return-why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-sm" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || why.trim().length < 3} onClick={() => void run({ action: "return", note: why })} className={primaryBtn}>
              Send back
            </button>
            <button type="button" onClick={() => setReturning(false)} className={quietBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !draft.neededBy}
            onClick={() => void run({ action: "edit", neededBy: draft.neededBy, leadDays: draft.leadDays, techLead: draft.techLead || null, ...(draft.workplanCode !== (item.workplanCode ?? "") ? { workplanCode: draft.workplanCode || null } : {}) })}
            className={primaryBtn}
          >
            Save changes
          </button>
          <button type="button" onClick={() => setEditing(false)} className={quietBtn}>
            Cancel
          </button>
          <span className="self-center text-xs text-muted">Changing it needs both approvals again.</span>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          {item.status !== "approved" && item.status !== "started" && asManager && !item.approvals.manager && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "approve", as: "manager" })} className={primaryBtn}>
              {isProcurementManager(user, users) ? "Approve for procurement" : `Approve for ${manager?.name ?? "procurement"}`}
            </button>
          )}
          {item.status !== "approved" && item.status !== "started" && asLead && !item.approvals.lead && item.techLead && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "approve", as: "lead" })} className={primaryBtn}>
              {user.id === item.techLead ? "Approve as technical lead" : `Approve for ${lead?.name ?? "the technical lead"}`}
            </button>
          )}
          {canChange && (
            <>
              <button type="button" onClick={() => setEditing(true)} className={quietBtn}>
                Change dates, lead or workplan row
              </button>
              <button type="button" onClick={() => setReturning(true)} className={quietBtn}>
                Send back
              </button>
            </>
          )}
          {item.status === "approved" && (isProcurementManager(user, users) || !!user.admin) && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "reopen" })} className={quietBtn}>
              Reopen
            </button>
          )}
        </div>
      )}
      {mine && item.status !== "approved" && item.status !== "started" && (
        <p className="mt-2 text-xs text-muted">
          You asked for this, so someone else approves it: {manager?.name ?? "the procurement manager"} for procurement and {lead && lead.id !== user.id ? lead.name : "a technical lead still to be chosen"} as technical lead.
        </p>
      )}
      {user.admin && !mine && !isProcurementManager(user, users) && user.id !== item.techLead && item.status !== "approved" && (
        <p className="mt-2 text-xs text-muted">You are an admin, so you can approve for others while the app is in draft. It is recorded as you signing for them.</p>
      )}
    </article>
    </Sheet>
  );
}

/**
 * Asking for a purchase that is not on the calendar: unplanned or urgent. It goes on the calendar
 * marked as not planned and needs the same two approvals before the request can start.
 */
function AskForm({
  lines,
  items,
  committed,
  currency,
  money,
  onAsk,
  onCancel,
  onDone,
}: {
  lines: BudgetLine[];
  /** The calendar and the commitments of purchases under way, for the line's one figure (lib/line-money). */
  items: PlanItem[];
  committed: Record<string, number>;
  currency: string;
  money: (n: number) => string;
  onAsk: ReturnType<typeof usePlan>["ask"];
  onCancel: () => void;
  onDone: (item: PlanItem) => void;
}) {
  const [title, setTitle] = useState("");
  const [budgetCode, setBudgetCode] = useState("");
  const [value, setValue] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [reason, setReason] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const line = lines.find((l) => l.code === budgetCode);
  // The same figure the requisition and the approver see: budget, less spent, less committed, less other asks.
  const room = line ? lineRoom(line, items, undefined, committed[line.code] ?? 0) : null;
  const cost = Number(value) || 0;
  // Sooner than the usual time to buy something this size: it is urgent whether ticked or not.
  const soon = cost > 0 && !!neededBy && new Date(`${neededBy}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime() < LEAD_DAYS[levelFor(toUsd(cost, currency))] * 86400000;
  const valid = title.trim().length >= 3 && !!line && cost > 0 && !!neededBy && reason.trim().length >= 10;
  const field = "mt-1 block min-h-11 w-full border border-line bg-paper px-2 py-2";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError("");
        try {
          onDone(await onAsk({ title: title.trim(), budgetCode, value: cost, neededBy, reason: reason.trim(), urgent }));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="mt-6"
      aria-labelledby="ask-title"
    >
      <SectionHead id="ask-title" className="mt-0">
        Ask for something not on the calendar
      </SectionHead>
      <Sheet className="mt-3">
      <p className="max-w-2xl text-sm text-muted">
        For a purchase nobody planned, or one that cannot wait. It goes on the calendar marked as not planned. The procurement manager and the technical lead approve it like any other purchase, and then the request starts the usual way.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          What is needed
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="e.g. Replacement water pump for the nursery" className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          Budget line it is charged to
          <select value={budgetCode} onChange={(e) => setBudgetCode(e.target.value)} className={field}>
            <option value="">Choose a budget line</option>
            {lines.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} {l.description}
              </option>
            ))}
          </select>
          {room && (
            <span className={`mt-1 block text-xs ${cost > room.afterAsks ? "text-clay" : "text-muted"}`}>
              {lineFigureText(room.figure, money)}.
              {cost > 0 && cost <= room.afterAsks && cost > room.afterPlanned ? ` Planned purchases on the line already use ${money(Math.max(0, room.figure.available - room.afterPlanned))} of it: the approvers will be told.` : ""}
            </span>
          )}
        </label>
        <label className="text-sm">
          Estimated cost ({currency})
          <input type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          Needed by
          <input type="date" min={today()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          Why was it not planned, or why is it urgent?
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="e.g. The old pump broke and seedlings need water every day." className={field} />
          <span className="mt-1 block text-xs text-muted">One short sentence. The people who approve it read this.</span>
        </label>
        <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={urgent || soon} disabled={soon} onChange={(e) => setUrgent(e.target.checked)} className="h-5 w-5 accent-forest" />
          Urgent
          {soon && <span className="text-xs text-muted">(needed sooner than a purchase this size usually takes)</span>}
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !valid} className={primaryBtn}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
        <button type="button" onClick={onCancel} className={quietBtn}>
          Cancel
        </button>
      </div>
      </Sheet>
    </form>
  );
}
