"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { usePlan } from "@/components/app/use-project-data";
import { Pill, SectionLabel, TODAY, TopBar, primaryBtn, quietBtn, type Tone } from "@/components/workspace/ui";
import type { BudgetLine, WorkplanItem } from "@/lib/budget";
import { canEditProject, userById, users, type AppUser } from "@/lib/demo";
import { METHOD, awaiting, isManager, procurementManager, type PlanItem, type PlanStatus } from "@/lib/procurement-plan";

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

export function ProcurementPlanPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const plan = usePlan(project.saved ? project.id : null);
  const { date } = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Links such as /tasks/plan?open=PP-003 or ?filter=mine.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("open")) setOpen(q.get("open"));
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
  const current = plan.items.find((i) => i.key === open) ?? null;
  const canBuild = isManager(user) || canEditProject(user) || !!user.admin;
  const total = plan.items.reduce((s, i) => s + i.value, 0);
  const count = (s: PlanStatus) => plan.items.filter((i) => i.status === s).length;

  const rebuild = async () => {
    setBusy(true);
    try {
      const r = await plan.rebuild();
      setNote(`Calendar updated from the budget: ${r.total} items (${r.added} new${r.removed ? `, ${r.removed} removed` : ""}). Items already approved or changed by someone were kept.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Procurement calendar</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Built from the budget lines marked to procure. The procurement manager and each line&apos;s technical lead approve it; approved purchases go on the Tasks calendar on the day they have to start.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/tasks?source=procurement" className={quietBtn}>
            Procurements in progress
          </Link>
          {canBuild && (
            <button type="button" onClick={() => void rebuild()} disabled={busy} className={primaryBtn}>
              {busy ? "Updating…" : plan.items.length ? "Update from budget" : "Build from budget"}
            </button>
          )}
        </div>
      </div>
      {note && (
        <p role="status" className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm">
          {note}
        </p>
      )}
      {plan.error && (
        <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {plan.error}
        </p>
      )}

      {plan.status === "loading" ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : !plan.items.length ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">
          {plan.budget?.lines.length ? (
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
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Planned purchases" value={`${plan.items.length}`} sub={money(total)} />
            <Stat label="Awaiting approval" value={`${count("draft") + count("returned")}`} />
            <Stat label="Approved" value={`${count("approved")}`} />
            <Stat label="Waiting on you" value={`${mineKeys.size}`} tone={mineKeys.size ? "text-clay" : undefined} />
          </dl>

          <div role="tablist" className="mt-6 flex flex-wrap gap-1 text-sm">
            {(
              [
                ["all", "All"],
                ["mine", "Mine"],
                ["draft", "Awaiting approval"],
                ["returned", "Sent back"],
                ["approved", "Approved"],
              ] as [Filter, string][]
            ).map(([f, label]) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 ${filter === f ? "bg-ink text-paper" : "bg-sunken text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(0,26rem)]">
            <div>
              {!shown.length && <p className="py-10 text-center text-sm text-muted">Nothing here.</p>}
              {months.map((m) => (
                <section key={m} className="mb-6">
                  <SectionLabel>Start in {date(`${m}-01`, { month: "long", year: "numeric" })}</SectionLabel>
                  <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                    {shown
                      .filter((i) => i.startBy.startsWith(m))
                      .map((i) => (
                        <li key={i.key}>
                          <button
                            type="button"
                            onClick={() => setOpen(i.key)}
                            aria-current={open === i.key ? "true" : undefined}
                            className={`flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-sunken ${open === i.key ? "bg-mist" : ""}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium leading-snug">{i.title}</span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                <span className="font-mono">{i.key}</span>
                                <span>· {i.budgetCode}</span>
                                <span>· {userById(i.techLead ?? "")?.name ?? "No technical lead"}</span>
                                {mineKeys.has(i.key) && <span className="font-semibold text-clay">· Waiting on you</span>}
                              </span>
                            </span>
                            <span className="shrink-0 text-end">
                              <span className="block tabular-nums text-sm">{money(i.value)}</span>
                              <span className="mt-1 flex justify-end gap-1">
                                <Pill tone={LEVEL_TONE[i.level]}>{i.level}</Pill>
                                <Pill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Pill>
                              </span>
                              <span className={`mt-1 block text-xs ${i.startBy < TODAY && i.status !== "started" ? "font-semibold text-clay" : "text-muted"}`}>
                                Start by {date(i.startBy)}
                                {i.startBy < TODAY && i.status !== "started" ? " · late" : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:rounded-2xl">
              {current ? (
                <Detail
                  key={current.key}
                  item={current}
                  user={user}
                  line={plan.budget?.lines.find((l) => l.code === current.budgetCode) ?? null}
                  wp={plan.workplan.find((w) => w.code === current.workplanCode && (!w.org || /rop|roots/i.test(w.org))) ?? plan.workplan.find((w) => w.code === current.workplanCode) ?? null}
                  money={money}
                  onAct={plan.act}
                  onClose={() => setOpen(null)}
                />
              ) : (
                <p className="hidden rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted lg:block">Open a purchase to see what it is for, how it will be bought and who approves it.</p>
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-sunken p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-display text-2xl tabular-nums ${tone ?? ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-muted tabular-nums">{sub}</dd>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Detail({
  item,
  user,
  line,
  wp,
  money,
  onAct,
  onClose,
}: {
  item: PlanItem;
  user: AppUser;
  line: BudgetLine | null;
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
  const [draft, setDraft] = useState({ neededBy: item.neededBy, leadDays: item.leadDays, techLead: item.techLead ?? "" });

  const lead = userById(item.techLead ?? "");
  const manager = procurementManager(users);
  const asManager = isManager(user) || !!user.admin;
  const asLead = user.id === item.techLead || !!user.admin;
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
    <article className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="plan-detail-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">
            {item.key} · {item.budgetCode}
          </p>
          <h2 id="plan-detail-title" className="mt-1 font-display text-xl leading-snug">
            {item.title}
          </h2>
          <p className="mt-2 flex flex-wrap gap-1">
            <Pill tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Pill>
            <Pill tone={LEVEL_TONE[item.level]}>{item.level}</Pill>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken">
          ×
        </button>
      </div>
      {item.returnNote && item.status === "returned" && <p className="mt-3 rounded-xl bg-clay-soft px-3 py-2 text-sm text-clay">Sent back: {item.returnNote}</p>}

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
            <span className="tabular-nums">{money(item.value)}</span> <span className="text-xs text-muted">≈ ${item.usd.toLocaleString("en-US")}</span>
          </Row>
          {line && (
            <Row label="Line budget">
              <span className="tabular-nums">{money(line.total)}</span>
              {line.spent ? <span className="block text-xs text-muted tabular-nums">{money(line.spent)} already spent</span> : null}
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
                  <span key={q} className="block text-xs tabular-nums">
                    {date(q, { month: "short", year: "numeric" })} quarter: {money(v)}
                  </span>
                ))}
            </Row>
          )}
        </dl>
        {!!line?.spent && (
          <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-xs text-muted">Part of this line is already spent. If an existing contract covers the rest (rent, internet, fuel), untick the line in the budget and it leaves the calendar.</p>
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
              <input type="date" value={draft.neededBy} onChange={(e) => setDraft({ ...draft, neededBy: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2" />
            </label>
            <label className="text-sm">
              Lead time (days)
              <input type="number" min={0} max={365} value={draft.leadDays} onChange={(e) => setDraft({ ...draft, leadDays: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2" />
            </label>
            <label className="text-sm sm:col-span-2">
              Technical lead
              <select value={draft.techLead} onChange={(e) => setDraft({ ...draft, techLead: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2">
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
              {date(item.neededBy, { day: "numeric", month: "short", year: "numeric" })}
              <span className="block text-xs text-muted">{item.neededWhy}</span>
            </Row>
            <Row label="Lead time">{item.leadDays} days (typical for {item.level.toLowerCase()} purchases)</Row>
            <Row label="Start by">
              <span className={item.startBy < TODAY && item.status !== "started" ? "font-semibold text-clay" : ""}>
                {date(item.startBy, { day: "numeric", month: "short", year: "numeric" })}
                {item.startBy < TODAY && item.status !== "started" ? " · late" : ""}
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
        {item.status === "approved" && (user.id === item.techLead || !!user.admin) && (
          <Link href={`/tasks?source=procurement&new=1&plan=${item.key}`} className={`${primaryBtn} mt-3 inline-block`}>
            {user.id === item.techLead ? "Start the procurement request" : `Start the request for ${lead?.name ?? "the lead"}`}
          </Link>
        )}
        {item.status === "started" && item.procurementKey && (
          <p className="mt-2 text-sm">
            Request made:{" "}
            <Link href={`/tasks?source=procurement&open=${item.procurementKey}`} className="font-semibold text-forest hover:underline">
              {item.procurementKey}
            </Link>
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {returning ? (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="return-why">
            What needs to change?
          </label>
          <textarea id="return-why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || why.trim().length < 3} onClick={() => void run({ action: "return", note: why })} className={primaryBtn}>
              Send back
            </button>
            <button type="button" onClick={() => setReturning(false)} className={quietBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : editing ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !draft.neededBy}
            onClick={() => void run({ action: "edit", neededBy: draft.neededBy, leadDays: draft.leadDays, techLead: draft.techLead || null })}
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
              {isManager(user) ? "Approve for procurement" : `Approve for ${manager?.name ?? "procurement"}`}
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
                Change dates or lead
              </button>
              <button type="button" onClick={() => setReturning(true)} className={quietBtn}>
                Send back
              </button>
            </>
          )}
          {item.status === "approved" && (isManager(user) || !!user.admin) && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "reopen" })} className={quietBtn}>
              Reopen
            </button>
          )}
        </div>
      )}
      {user.admin && !isManager(user) && user.id !== item.techLead && item.status !== "approved" && (
        <p className="mt-2 text-xs text-muted">You are an admin, so you can approve for others while the app is in draft. It is recorded as you signing for them.</p>
      )}
    </article>
  );
}
