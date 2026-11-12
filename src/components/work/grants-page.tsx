"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Board, cardClass } from "@/components/workspace/board";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { realToday } from "@/lib/clock";
import {
  GRANT_STEPS,
  GRANT_TYPES,
  REQUIRED_STEPS,
  approverFor,
  blockers,
  contributed,
  daysSince,
  grantColumns,
  granteeSharePct,
  isStuck,
  itemsFor,
  nextStepOf,
  shareNeeded,
  stepsIn,
  type Grant,
  type GrantAction,
  type GrantFields,
  type GrantStep,
  type StepSettings,
} from "@/lib/grants";
import type { MessageKey } from "@/lib/i18n";
import type { GrantCard } from "@/server/boards-store";
import type { GrantsView } from "@/server/grants-store";

/**
 * Agribusiness grants (lib/grants.ts): the board for the current project, with the open grant's
 * checklist below it, or every project's grants side by side.
 */

const input = "mt-1 block w-full min-h-12 rounded-xl border border-line bg-paper px-3 py-2 text-base";
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function call<T>(url: string, user: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { view?: T };
    err.view = (body as { view?: T }).view;
    throw err;
  }
  return body as T;
}

function useStepName(steps: StepSettings) {
  const { t } = useT();
  return (s: GrantStep | "closed") => (s !== "closed" && steps.names[s]) || t(`gr.step.${s}` as MessageKey);
}

const EMPTY: GrantFields = { business: "", province: "", type: "matching", purpose: "", value: 0, investment: 0, womenOwned: false };

function GrantForm({ start, onSave, onCancel }: { start: GrantFields; onSave: (f: GrantFields) => Promise<void>; onCancel: () => void }) {
  const { t } = useT();
  const [f, setF] = useState(start);
  const num = (k: "value" | "investment") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value.replace(/[,$\s]/g, "")) || 0 });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(f).catch(() => {});
      }}
    >
      <label className="text-sm font-semibold sm:col-span-2">
        {t("gr.f.business")}
        <input className={input} value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })} required minLength={2} />
        <span className="mt-1 block text-xs font-normal text-muted">{t("gr.f.noNames")}</span>
      </label>
      <label className="text-sm font-semibold">
        {t("gr.f.type")}
        <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as GrantFields["type"] })}>
          {GRANT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`gr.type.${x}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold">
        {t("gr.f.province")}
        <input className={input} value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })} />
      </label>
      <label className="text-sm font-semibold">
        {t("gr.f.value")}
        <input inputMode="decimal" className={input} value={f.value || ""} onChange={num("value")} />
      </label>
      <label className="text-sm font-semibold">
        {t("gr.f.investment")}
        <input inputMode="decimal" className={input} value={f.investment || ""} onChange={num("investment")} />
      </label>
      <label className="text-sm font-semibold sm:col-span-2">
        {t("gr.f.purpose")}
        <textarea rows={2} className={input} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
      </label>
      <label className="flex min-h-12 items-center gap-2 text-sm font-semibold sm:col-span-2">
        <input type="checkbox" className="h-5 w-5" checked={f.womenOwned} onChange={(e) => setF({ ...f, womenOwned: e.target.checked })} />
        {t("gr.f.women")}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn}>
          {t("gr.save")}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          {t("gr.cancel")}
        </button>
      </div>
    </form>
  );
}

/** A card on the board: the business, the money, how far the step is, how long it has waited. */
function CardBody({ g, left, today, stepTag }: { g: Pick<Grant, "business" | "value" | "type" | "province" | "womenOwned" | "since" | "status" | "closedWhy">; left: number; today: string; stepTag?: string }) {
  const { t } = useT();
  const days = daysSince(g.since, today);
  return (
    <>
      <span className="block font-semibold">{g.business}</span>
      <span className="mt-0.5 block text-xs text-muted">
        {usd(g.value)} · {t(`gr.type.${g.type}` as MessageKey)}
        {g.province ? ` · ${g.province}` : ""}
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        {stepTag && <Pill tone="muted">{stepTag}</Pill>}
        {g.womenOwned && <Pill tone="plum">{t("gr.womenTag")}</Pill>}
        {g.status === "done" ? <Pill tone="forest">{t("gr.doneTag")}</Pill> : g.status === "open" ? left ? <Pill tone="muted">{t("gr.left", { n: left })}</Pill> : <Pill tone="forest">{t("gr.ready")}</Pill> : null}
      </span>
      {g.status === "open" && <span className={`mt-1 block text-[11px] ${isStuck(g.since, today) ? "font-semibold text-ochre" : "text-muted"}`}>{t(isStuck(g.since, today) ? "bd.stuck" : "bd.days", { n: days })}</span>}
      {g.closedWhy && <span className="mt-1 block text-xs text-muted">{g.closedWhy}</span>}
    </>
  );
}

function Detail({ g, v, act }: { g: Grant; v: GrantsView; act: (a: GrantAction) => Promise<void> }) {
  const { t, date } = useT();
  const name = useStepName(v.steps);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<"rejected" | "withdrawn" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [proof, setProof] = useState("");
  const [pr, setPr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = (a: GrantAction) => {
    setBusy(true);
    return act(a).finally(() => setBusy(false));
  };
  const rev = g.rev;
  const open = g.status === "open";
  const left = blockers(g, v.rules);
  const next = nextStepOf(g.step, v.steps);
  const as = approverFor(g, v.rules);
  const mayApprove = as === "ho" ? v.can.approveHo : v.can.approveCop;
  const owed = Math.max(0, g.investment - g.value);
  const earlier = stepsIn(v.steps).filter((s) => GRANT_STEPS.indexOf(s) < GRANT_STEPS.indexOf(g.step));
  const checkRow = (id: string) => {
    const tick = g.checks[id];
    return (
      <li key={id}>
        <label className="flex min-h-12 items-start gap-3 py-1">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={!!tick} disabled={!open || busy} onChange={(e) => void run({ action: "check", id: g.id, rev, item: id, done: e.target.checked }).catch(() => {})} />
          <span className="min-w-0">
            <span className="block">{t(`gr.check.${id}` as MessageKey)}</span>
            {tick && <span className="block text-xs text-muted">{t("gr.by", { name: tick.byName, date: date(tick.at) })}</span>}
          </span>
        </label>
      </li>
    );
  };

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label={g.business}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{g.id}</p>
          <h2 className="font-display text-2xl tracking-tight">{g.business}</h2>
          <p className="text-sm text-muted">
            {usd(g.value)} · {t(`gr.type.${g.type}` as MessageKey)}
            {g.province ? ` · ${g.province}` : ""} · {name(g.status === "open" || g.status === "done" ? g.step : "closed")}
          </p>
          {g.purpose && <p className="mt-1 text-sm">{g.purpose}</p>}
        </div>
        {open && !editing && (
          <button type="button" className={quietBtn} onClick={() => setEditing(true)}>
            {t("gr.edit")}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <GrantForm start={g} onCancel={() => setEditing(false)} onSave={(fields) => run({ action: "edit", id: g.id, rev, fields }).then(() => setEditing(false))} />
        </div>
      ) : (
        <>
          <p className={`mt-3 text-sm ${granteeSharePct(g) < shareNeeded(g, v.rules) ? "text-clay" : "text-muted"}`}>{t("gr.share", { have: granteeSharePct(g), need: shareNeeded(g, v.rules) })}</p>
          {v.rules.capUsd !== null && g.value > v.rules.capUsd && <p className="mt-1 text-sm text-clay">{t("gr.cap", { cap: v.rules.capUsd.toLocaleString("en-US") })}</p>}

          {open && (
            <>
              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {t("gr.thisStep")}: {name(g.step)}
              </h3>
              <ul className="mt-1">{itemsFor(g, g.step).map((c) => checkRow(c.id))}</ul>

              {g.step === "approval" && (
                <div className="mt-2 rounded-xl bg-paper p-3 text-sm">
                  {g.approval ? (
                    <p className="text-forest">{t("gr.approved", { name: g.approval.byName, as: t(g.approval.as === "ho" ? "gr.as.ho" : "gr.as.cop"), date: date(g.approval.at) })}</p>
                  ) : mayApprove ? (
                    <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run({ action: "approve", id: g.id, rev }).catch(() => {})}>
                      {t("gr.approve", { as: t(as === "ho" ? "gr.as.ho" : "gr.as.cop") })}
                    </button>
                  ) : (
                    <p className="text-muted">{t(as === "ho" ? "gr.approver.ho" : "gr.approver.cop")}</p>
                  )}
                </div>
              )}

              {(g.step === "agreement" || g.step === "implementation") && (
                <div className="mt-3 rounded-xl bg-paper p-3 text-sm">
                  <p className="font-semibold">{t("gr.contrib")}</p>
                  <p className="text-muted">{t("gr.contribHave", { have: Math.round(contributed(g)).toLocaleString("en-US"), need: Math.round(owed).toLocaleString("en-US") })}</p>
                  <ul className="mt-1 text-xs text-muted">
                    {g.contributions.map((c, i) => (
                      <li key={i}>
                        {usd(c.amount)}: {c.proof} ({t("gr.by", { name: c.byName, date: date(c.at) })})
                      </li>
                    ))}
                  </ul>
                  <form
                    className="mt-2 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run({ action: "contribution", id: g.id, rev, amount: Number(amount.replace(/[,$\s]/g, "")), proof })
                        .then(() => (setAmount(""), setProof("")))
                        .catch(() => {});
                    }}
                  >
                    <input aria-label={t("gr.amount")} placeholder={t("gr.amount")} inputMode="decimal" className="min-h-12 w-36 rounded-xl border border-line bg-surface px-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <input aria-label={t("gr.proof")} placeholder={t("gr.proof")} className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3" value={proof} onChange={(e) => setProof(e.target.value)} />
                    <button type="submit" className={quietBtn} disabled={busy || !Number(amount.replace(/[,$\s]/g, "")) || proof.trim().length < 3}>
                      {t("gr.contribAdd")}
                    </button>
                  </form>
                </div>
              )}

              {g.type === "inKind" && GRANT_STEPS.indexOf(g.step) >= GRANT_STEPS.indexOf("agreement") && (
                <div className="mt-3 text-sm">
                  <p className="font-semibold">{t("gr.procurements")}</p>
                  <p className="mt-1 flex flex-wrap gap-2">
                    {g.procurements.map((p) => (
                      <Link key={p} href={`/work?source=procurement&open=${p}&project=${v.code}`} className="text-forest hover:underline">
                        {p}
                      </Link>
                    ))}
                  </p>
                  <form
                    className="mt-1 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run({ action: "link", id: g.id, rev, procurement: pr.trim().toUpperCase() })
                        .then(() => setPr(""))
                        .catch(() => {});
                    }}
                  >
                    <input aria-label={t("gr.procurements")} placeholder="PR-2027-014" className="min-h-12 w-44 rounded-xl border border-line bg-paper px-3" value={pr} onChange={(e) => setPr(e.target.value)} />
                    <button type="submit" className={quietBtn} disabled={busy || pr.trim().length < 3}>
                      {t("gr.link")}
                    </button>
                  </form>
                </div>
              )}

              {left.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="font-semibold">{t("gr.blocked")}</p>
                  <ul className="list-disc ps-5 text-muted">
                    {left.map((b) => (
                      <li key={b.key}>{t(b.key as MessageKey, b.vars)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy || left.length > 0} onClick={() => void run({ action: "advance", id: g.id, rev }).catch(() => {})}>
                  {next ? t("gr.advance", { step: name(next) }) : t("gr.finish")}
                </button>
                {g.step !== "implementation" && g.step !== "closeout" && (
                  <>
                    <button type="button" className={quietBtn} onClick={() => setClosing("rejected")}>
                      {t("gr.reject")}
                    </button>
                    <button type="button" className={quietBtn} onClick={() => setClosing("withdrawn")}>
                      {t("gr.withdraw")}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {(g.status === "rejected" || g.status === "withdrawn") && (
            <div className="mt-3 text-sm">
              <p className="text-muted">{t("gr.closedWhy", { what: t(g.status === "rejected" ? "gr.rejected" : "gr.withdrawn"), why: g.closedWhy ?? "" })}</p>
              <button type="button" className={`${quietBtn} mt-2`} onClick={() => setClosing("reopen")}>
                {t("gr.reopen")}
              </button>
            </div>
          )}
          {closing && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const a: GrantAction = closing === "reopen" ? { action: "reopen", id: g.id, rev, reason } : { action: "close", id: g.id, rev, outcome: closing, reason };
                void run(a)
                  .then(() => (setClosing(null), setReason("")))
                  .catch(() => {});
              }}
            >
              <input aria-label={t("gr.reason")} placeholder={t("gr.reason")} className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="submit" className={primaryBtn} disabled={busy || reason.trim().length < 10}>
                {closing === "reopen" ? t("gr.reopen") : closing === "rejected" ? t("gr.reject") : t("gr.withdraw")}
              </button>
              <button type="button" className={quietBtn} onClick={() => setClosing(null)}>
                {t("gr.cancel")}
              </button>
            </form>
          )}

          {earlier.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold">{t("gr.earlier")}</summary>
              {earlier.map((s) => (
                <div key={s} className="mt-2">
                  <p className="text-xs font-semibold text-muted">{name(s)}</p>
                  <ul>{itemsFor(g, s).map((c) => checkRow(c.id))}</ul>
                </div>
              ))}
            </details>
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">{t("gr.history")}</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {[...g.history].reverse().map((h, i) => (
                <li key={i}>
                  {date(h.at)} · {h.byName}: {h.what}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function StepsPanel({ v, act }: { v: GrantsView; act: (a: GrantAction) => Promise<void> }) {
  const { t } = useT();
  const [names, setNames] = useState<Partial<Record<GrantStep, string>>>(v.steps.names);
  const [skip, setSkip] = useState<GrantStep[]>(v.steps.skip);
  const [source, setSource] = useState(v.steps.source);
  const [saved, setSaved] = useState(false);
  return (
    <details className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold">{t("gr.steps.title")}</summary>
      <p className="mt-2 text-muted">{t("gr.steps.help")}</p>
      <ul className="mt-3 space-y-2">
        {GRANT_STEPS.map((s) => (
          <li key={s} className="flex flex-wrap items-center gap-3">
            <input aria-label={t(`gr.step.${s}` as MessageKey)} placeholder={t(`gr.step.${s}` as MessageKey)} className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3" value={names[s] ?? ""} onChange={(e) => (setNames({ ...names, [s]: e.target.value }), setSaved(false))} />
            <label className="flex min-h-12 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" disabled={REQUIRED_STEPS.includes(s)} checked={skip.includes(s) && !REQUIRED_STEPS.includes(s)} onChange={(e) => (setSkip(e.target.checked ? [...skip, s] : skip.filter((x) => x !== s)), setSaved(false))} />
              {t("gr.steps.skip")}
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-3 block font-semibold">
        {t("gr.steps.source")}
        <input className={input} value={source} onChange={(e) => (setSource(e.target.value), setSaved(false))} />
      </label>
      <button
        type="button"
        className={`${primaryBtn} mt-3`}
        onClick={() =>
          void act({ action: "steps", names: Object.fromEntries(Object.entries(names).filter(([, x]) => x?.trim())) as Record<GrantStep, string>, skip, source })
            .then(() => setSaved(true))
            .catch(() => {})
        }
      >
        {t("gr.steps.save")}
      </button>
      {saved && (
        <span role="status" className="ms-3 text-forest">
          {t("gr.steps.saved")}
        </span>
      )}
    </details>
  );
}

function ProjectGrants({ user }: { user: string }) {
  const { t } = useT();
  const { project } = useCurrentProject();
  const [v, setV] = useState<GrantsView | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const url = `/api/projects/${encodeURIComponent(project.id)}/grants`;
  const sample = project.kind === "sample";

  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) setPicked(open);
  }, []);
  const load = useCallback(async () => {
    setError("");
    try {
      setV(await call<GrantsView>(url, user));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url, user]);
  useEffect(() => {
    setV(null);
    if (project.saved) void load();
  }, [project.saved, load]);

  const act = async (a: GrantAction) => {
    setError("");
    try {
      setV(await call<GrantsView>(url, user, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      const err = e as Error & { view?: GrantsView };
      if (err.view) setV(err.view);
      setError(err.message);
      throw e;
    }
  };

  const name = useStepName(v?.steps ?? { names: {}, skip: [], source: "" });
  if (!project.saved) return <p className="mt-6 text-sm text-muted">{t("gr.notSaved")}</p>;
  const today = realToday();
  const cols = v
    ? grantColumns(v.items, v.steps).map((c) => ({
        id: c.id,
        title: name(c.id as GrantStep | "closed"),
        count: c.items.length,
        folded: c.id === "closed",
        cards: c.items.map((g) => (
          <button key={g.id} type="button" aria-pressed={picked === g.id} onClick={() => setPicked(picked === g.id ? null : g.id)} className={`${cardClass(g.status === "open" && isStuck(g.since, today))} w-full ${picked === g.id ? "ring-2 ring-forest" : ""}`}>
            <CardBody g={g} left={blockers(g, v.rules).length} today={today} />
          </button>
        )),
      }))
    : [];
  const g = v?.items.find((x) => x.id === picked);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">{t("gr.help")}</p>
        {v?.can.add && !sample && !adding && (
          <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
            {t("gr.add")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}
      {adding && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <GrantForm
            start={EMPTY}
            onCancel={() => setAdding(false)}
            onSave={(fields) =>
              act({ action: "add", fields }).then(() => {
                setAdding(false);
              })
            }
          />
        </section>
      )}
      {!v && !error && <p className="mt-6 text-sm text-muted">{t("bd.loading")}</p>}
      {v && v.items.length === 0 && !adding && <p className="mt-6 text-sm text-muted">{t("gr.none")}</p>}
      {v && v.items.length > 0 && (
        <>
          <p className="mt-3 text-xs text-muted">{t("bd.help")}</p>
          <Board columns={cols} label={t("gr.title")} />
        </>
      )}
      {v && g && <Detail key={g.id} g={g} v={v} act={act} />}
      {v?.can.steps && !sample && <StepsPanel key={JSON.stringify(v.steps)} v={v} act={act} />}
    </>
  );
}

function AllGrants({ user }: { user: string }) {
  const { t } = useT();
  const [cards, setCards] = useState<GrantCard[] | null>(null);
  const [error, setError] = useState("");
  const name = useStepName({ names: {}, skip: [], source: "" });
  useEffect(() => {
    call<{ cards: GrantCard[] }>("/api/boards/grants", user)
      .then((r) => setCards(r.cards))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  const today = realToday();
  if (error)
    return (
      <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
        {error}
      </p>
    );
  if (!cards) return <p className="mt-6 text-sm text-muted">{t("bd.loading")}</p>;
  if (!cards.length) return <p className="mt-6 text-sm text-muted">{t("gr.none")}</p>;
  const columns = [
    ...GRANT_STEPS.map((s) => ({ id: s as string, list: cards.filter((c) => (c.status === "open" || c.status === "done") && c.step === s) })),
    { id: "closed", list: cards.filter((c) => c.status === "rejected" || c.status === "withdrawn") },
  ].map((c) => ({
    id: c.id,
    title: name(c.id as GrantStep | "closed"),
    count: c.list.length,
    folded: c.id === "closed",
    cards: c.list
      .sort((a, b) => a.since.localeCompare(b.since))
      .map((g) => (
        <Link key={`${g.project.code}/${g.id}`} href={`/work/grants?project=${encodeURIComponent(g.project.code)}&open=${g.id}`} className={cardClass(g.status === "open" && isStuck(g.since, today))}>
          <span className="mb-1 flex flex-wrap gap-1 text-[11px] text-muted">
            {g.project.code}
            {g.project.sandbox && <Pill tone="sky">{t("bd.sandbox")}</Pill>}
          </span>
          <CardBody g={{ ...g, closedWhy: null }} left={g.left} today={today} />
        </Link>
      )),
  }));
  return (
    <>
      <p className="mt-2 text-sm text-muted">{t("gr.helpAll")}</p>
      <Board columns={columns} label={t("gr.title")} />
    </>
  );
}

export function GrantsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { t } = useT();
  const [scope, setScope] = useState<"project" | "all">("project");
  if (!user || !ready) return null;
  return (
    <div className="min-h-screen">
      <TopBar active="tasks" />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Link href="/work" className="text-sm text-muted hover:text-ink">
          ← {t("nav.record")}
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">{t("gr.title")}</h1>
          <div role="group" className="inline-flex rounded-full bg-mist p-0.5 text-sm">
            {(["project", "all"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={`rounded-full px-3 py-1.5 ${scope === s ? "bg-forest text-paper" : "text-forest"}`}>
                {t(s === "project" ? "bd.thisProject" : "bd.allProjects")}
              </button>
            ))}
          </div>
        </div>
        {scope === "project" ? <ProjectGrants user={user.id} /> : <AllGrants user={user.id} />}
      </main>
    </div>
  );
}
