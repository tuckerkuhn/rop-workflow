"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { SOURCES, type OppAction, type Opportunity } from "@/lib/opportunities";
import type { OpportunitiesView } from "@/server/opportunities-store";
import { TrackRecordButton } from "@/components/work/track-record-button";
import { useT } from "@/components/app/i18n";
import { Board, ViewSwitch, cardClass } from "@/components/workspace/board";
import { usePersistentState } from "@/components/workspace/ui";
import { deadlineSoon, opportunityColumns } from "@/lib/boards";
import { realToday } from "@/lib/clock";
import type { MessageKey } from "@/lib/i18n";

/** Develop: opportunities, their framing and match brief, and the match call. */

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const STATUS = { tracking: { tone: "ochre", text: "To decide" }, match: { tone: "forest", text: "Match" }, designing: { tone: "sky", text: "In design" }, no_match: { tone: "muted", text: "No match" } } as const;
type Fields = Pick<Opportunity, "title" | "donor" | "source" | "link" | "country" | "deadline" | "value" | "currency" | "need" | "donorPriorities" | "capacity" | "risks" | "grossIncome">;
const EMPTY: Fields = { title: "", donor: "", source: "Donor call", link: "", country: "", deadline: null, value: null, currency: "USD", need: "", donorPriorities: "", capacity: "", risks: "", grossIncome: "" };

async function call(user: string, init?: RequestInit): Promise<OpportunitiesView> {
  const res = await fetch("/api/opportunities", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as OpportunitiesView;
}

function OppForm({ start, onSave, onCancel }: { start: Fields; onSave: (f: Fields) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(start);
  const t = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(f);
      }}
    >
      <label className="text-sm sm:col-span-2">
        Opportunity
        <input className={input} value={f.title} onChange={t("title")} required />
      </label>
      <label className="text-sm">
        Donor
        <input className={input} value={f.donor} onChange={t("donor")} required />
      </label>
      <label className="text-sm">
        Where it came from
        <select className={input} value={f.source} onChange={t("source")}>
          {SOURCES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Country
        <input className={input} value={f.country} onChange={t("country")} />
      </label>
      <label className="text-sm">
        Deadline
        <input type="date" className={input} value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value || null })} />
      </label>
      <label className="text-sm">
        Value
        <input inputMode="decimal" className={input} value={f.value ?? ""} onChange={(e) => setF({ ...f, value: e.target.value ? Number(e.target.value.replace(/,/g, "")) : null })} />
      </label>
      <label className="text-sm">
        Link to the call or notes
        <input className={input} value={f.link} onChange={t("link")} />
      </label>
      {(
        [
          ["need", "The need or problem (donor-informed and team-confirmed, or team-identified)"],
          ["donorPriorities", "What the donor wants"],
          ["capacity", "ROP's capacity: staff, presence, partners"],
          ["risks", "Risks"],
          ["grossIncome", "50% gross income analysis"],
        ] as [keyof Fields, string][]
      ).map(([k, label]) => (
        <label key={k} className="text-sm sm:col-span-2">
          {label}
          <textarea rows={2} className={input} value={String(f[k] ?? "")} onChange={t(k)} />
        </label>
      ))}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn}>
          Save
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The donor pipeline as a board: one column per stage of the match call, nearest deadline first. */
function PipelineBoard({ items, picked, pick }: { items: Opportunity[]; picked: string | null; pick: (id: string) => void }) {
  const { t, date } = useT();
  const today = realToday();
  const columns = opportunityColumns(items).map((c) => ({
    id: c.id,
    title: t(`bd.opp.${c.id}` as MessageKey),
    count: c.items.length,
    folded: c.id === "no_match",
    cards: c.items.map((o) => (
      <button key={o.id} type="button" aria-pressed={picked === o.id} onClick={() => pick(o.id)} className={`${cardClass(false)} w-full ${picked === o.id ? "ring-2 ring-forest" : ""}`}>
        <span className="block font-semibold">{o.title}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {o.donor}
          {o.value ? ` · ${o.currency} ${o.value.toLocaleString("en-US")}` : ""}
          {o.country ? ` · ${o.country}` : ""}
        </span>
        {o.deadline && <span className={`mt-1 block text-xs ${deadlineSoon(o.deadline, today) ? "font-semibold text-clay" : "text-muted"}`}>{t("bd.opp.deadline", { date: date(o.deadline) })}</span>}
        <span className="mt-1 block text-[11px] text-muted">{o.source}</span>
      </button>
    )),
  }));
  return <Board columns={columns} label="Donor pipeline" />;
}

function Card({ o, v, act }: { o: Opportunity; v: OpportunitiesView; act: (a: OppAction) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const st = STATUS[o.status];
  const b = o.brief;
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{o.title}</p>
          <p className="text-xs text-muted">
            {o.donor} · {o.source}
            {o.country ? ` · ${o.country}` : ""}
            {o.deadline ? ` · deadline ${o.deadline}` : ""}
            {o.value ? ` · ${o.currency} ${o.value.toLocaleString("en-US")}` : ""}
            {o.link && (
              <>
                {" · "}
                <a href={o.link} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                  call
                </a>
              </>
            )}
          </p>
        </div>
        <Pill tone={st.tone}>{st.text}</Pill>
      </div>
      {editing ? (
        <div className="mt-3">
          <OppForm start={o} onCancel={() => setEditing(false)} onSave={(fields) => act({ action: "edit", id: o.id, fields }).then(() => setEditing(false))} />
        </div>
      ) : (
        <>
          {b ? (
            <div className="mt-3 space-y-1.5 rounded-xl bg-paper p-3 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Match brief (AI draft, {b.at}): check it before the call</p>
              <p>{b.summary}</p>
              <p>
                <span className="font-semibold">Fit: </span>
                {b.fit}
              </p>
              <p>
                <span className="font-semibold">Need: </span>
                {b.need}
              </p>
              <p>
                <span className="font-semibold">Donor priorities: </span>
                {b.donorPriorities}
              </p>
              <p>
                <span className="font-semibold">50% gross income: </span>
                {b.grossIncome}
              </p>
              <p>
                <span className="font-semibold">Capacity: </span>
                {b.capacity}
              </p>
              {b.risks.length > 0 && <p className="font-semibold">Risks</p>}
              <ul className="list-disc ps-5">
                {b.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {b.questions.length > 0 && <p className="font-semibold">To find out before the call</p>}
              <ul className="list-disc ps-5">
                {b.questions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            o.need && <p className="mt-2 text-sm">{o.need}</p>
          )}
          {o.decision && (
            <p className={`mt-3 text-sm ${o.decision.match ? "text-forest" : "text-muted"}`}>
              <span className="font-semibold">{o.decision.match ? "Match" : "No match"}</span>, {o.decision.byName} on {o.decision.at}: {o.decision.reason}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {o.status === "tracking" && (
              <>
                <button type="button" className={quietBtn} onClick={() => setEditing(true)}>
                  Edit
                </button>
                {v.can.brief && (
                  <button
                    type="button"
                    className={quietBtn}
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void act({ action: "brief", id: o.id }).finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Drafting… (up to a minute)" : b ? "Redraft the match brief" : "Draft the match brief"}
                  </button>
                )}
                {v.can.decide && (
                  <>
                    <button type="button" className={primaryBtn} onClick={() => setDeciding(true)}>
                      Match
                    </button>
                    <button type="button" className={quietBtn} onClick={() => setDeciding(false)}>
                      No match
                    </button>
                  </>
                )}
              </>
            )}
            {o.status === "match" && (
              <Link href={`/setup?new=1&name=${encodeURIComponent(o.title)}`} className={primaryBtn}>
                Start the design
              </Link>
            )}
            {(o.status === "match" || o.status === "no_match") && v.can.decide && (
              <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => void act({ action: "reopen", id: o.id, reason: window.prompt("Why reopen it?") ?? "" })}>
                Reopen
              </button>
            )}
          </div>
          {deciding !== null && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "decide", id: o.id, match: deciding, reason }).then(() => setDeciding(null));
              }}
            >
              <input className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm" placeholder={deciding ? "Why it is a match" : "Why not: kept so the next similar call learns from it"} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="submit" className={primaryBtn} disabled={reason.trim().length < 10}>
                {deciding ? "Record match" : "Record no match"}
              </button>
            </form>
          )}
        </>
      )}
    </li>
  );
}

export function OpportunitiesPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<OpportunitiesView | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [view, setView] = usePersistentState<"board" | "list">("rop-opps-view", () => "list");
  const [picked, setPicked] = useState<string | null>(null);
  // From "+ New → Record an opportunity".
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setAdding(true);
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);
  if (!user) return null;
  const act = async (a: OppAction) => {
    setError("");
    try {
      setV(await call(user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className={`mx-auto px-4 py-6 sm:px-6 ${view === "board" ? "max-w-7xl" : "max-w-3xl"}`}>
        <Link href="/work" className="text-sm text-muted hover:text-ink">
          ← Work
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">Opportunities</h1>
          {v && v.items.length > 0 && <ViewSwitch value={view} onChange={setView} />}
          {v && <TrackRecordButton user={user.id} />}
          {v?.can.add && !adding && (
            <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
              + Record an opportunity
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">Develop: frame each opportunity, draft the match brief, and make the match call. A no-match keeps its reason, so resources go to better opportunities.</p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {adding && (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <OppForm start={EMPTY} onCancel={() => setAdding(false)} onSave={(fields) => act({ action: "add", fields }).then(() => setAdding(false))} />
          </section>
        )}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && v.items.length === 0 && !adding && <p className="mt-6 text-sm text-muted">No opportunities recorded yet.</p>}
        {v && view === "board" && v.items.length > 0 ? (
          <>
            <PipelineBoard items={v.items} picked={picked} pick={(id) => setPicked(picked === id ? null : id)} />
            <ul className="mt-2 space-y-3">
              {v.items
                .filter((o) => o.id === picked)
                .map((o) => (
                  <Card key={o.id} o={o} v={v} act={act} />
                ))}
            </ul>
          </>
        ) : (
          <ul className="mt-4 space-y-3">
            {v?.items.map((o) => (
              <Card key={o.id} o={o} v={v} act={act} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
