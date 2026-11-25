"use client";

import { plainError } from "@/lib/plain-error";
import { askReason } from "@/components/app/dialogs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn, StatusPill } from "@/components/workspace/ui";
import { DOC_LABELS, SOURCES, type CallReading, type OppAction, type OppDoc, type Opportunity } from "@/lib/opportunities";
import { openReceipt } from "@/components/people/expense-page";
import type { Receipt } from "@/lib/expense";
import type { OpportunitiesView } from "@/server/opportunities-store";
import { TrackRecordButton } from "@/components/work/track-record-button";
import { useT } from "@/components/app/i18n";
import { Board, ViewSwitch, cardClass } from "@/components/workspace/board";
import { usePersistentState } from "@/components/workspace/ui";
import { deadlineSoon, opportunityColumns } from "@/lib/boards";
import { realToday } from "@/lib/clock";
import { opensProposals } from "@/lib/org-areas";
import type { MessageKey } from "@/lib/i18n";

/** Develop: opportunities, their framing and match brief, and the match call. */

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const STATUS = {
  tracking: { tone: "ochre", text: "To decide" },
  match: { tone: "forest", text: "Match" },
  designing: { tone: "sky", text: "In design" },
  no_match: { tone: "muted", text: "No match" },
} as const;
type Fields = Pick<Opportunity, "title" | "donor" | "source" | "link" | "country" | "deadline" | "value" | "currency" | "need" | "donorPriorities" | "capacity" | "risks" | "notes" | "funderContact" | "documents">;
const EMPTY: Fields = {
  title: "",
  donor: "",
  source: "Donor call",
  link: "",
  country: "",
  deadline: null,
  value: null,
  currency: "USD",
  need: "",
  donorPriorities: "",
  capacity: "",
  risks: "",
  notes: "",
  funderContact: "",
  documents: [],
};
const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "AFN", "GTQ"];
const DOC_MAX = 8;

async function uploadDoc(file: File, user: string): Promise<Receipt> {
  const body = new FormData();
  body.append("file", file);
  body.append("purpose", "document");
  const res = await fetch("/api/files", {
    method: "POST",
    body,
    headers: { "x-demo-user": user },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error ?? plainError(res.status));
  return out as Receipt;
}

async function call(user: string, init?: RequestInit): Promise<OpportunitiesView> {
  const res = await fetch("/api/opportunities", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as OpportunitiesView;
}

/** The call and its annexes: attach several at once, say what each is, remove before saving. */
function DocumentsField({ docs, onChange, onAdded }: { docs: OppDoc[]; onChange: (d: OppDoc[]) => void; onAdded: (d: OppDoc[]) => void }) {
  const { user } = useSession();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const room = DOC_MAX - docs.length;
  return (
    <div className="text-sm">
      <p>Call documents</p>
      <p className="mt-0.5 text-xs text-muted">The call (a CFP, RFP, RFA, NOFO or similar) and everything that comes with it: annexes, templates, budget sheets. PDF, Word or Excel, up to 4 MB each. Choose several at once if you have them.</p>
      {docs.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
          {docs.map((d) => (
            <li key={d.hash} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <select
                aria-label={`What ${d.name} is`}
                className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
                value={d.label}
                onChange={(e) => onChange(docs.map((x) => (x.hash === d.hash ? { ...x, label: e.target.value as OppDoc["label"] } : x)))}
              >
                {DOC_LABELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <button type="button" className="text-xs font-semibold text-muted hover:text-ink hover:underline" onClick={() => onChange(docs.filter((x) => x.hash !== d.hash))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {room > 0 && (
        <input
          type="file"
          multiple
          aria-label="Attach call documents"
          accept="application/pdf,.pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="mt-2 block w-full py-2 text-sm"
          disabled={!!busy || !user}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files.length || !user) return;
            setError("");
            const added: OppDoc[] = [];
            const problems: string[] = [];
            // The first file is taken to be the call itself unless one is already there; the person can change it.
            let callTaken = docs.some((d) => d.label === DOC_LABELS[0]);
            for (const [i, file] of files.slice(0, room).entries()) {
              setBusy(`Uploading ${i + 1} of ${Math.min(files.length, room)}…`);
              try {
                const r = await uploadDoc(file, user.id);
                if (docs.some((d) => d.hash === r.hash) || added.some((d) => d.hash === r.hash)) continue;
                added.push({
                  ...r,
                  label: callTaken ? DOC_LABELS[1] : DOC_LABELS[0],
                  by: user.id,
                  at: realToday(),
                });
                callTaken = true;
              } catch (x) {
                problems.push(x instanceof Error ? x.message : String(x));
              }
            }
            if (files.length > room) problems.push(`Only ${DOC_MAX} documents fit: ${files.length - room} not attached.`);
            setBusy("");
            setError(problems.join(" "));
            if (added.length) {
              const next = [...docs, ...added];
              onChange(next);
              onAdded(next);
            }
          }}
        />
      )}
      {busy && <p className="mt-1 text-xs text-muted">{busy}</p>}
      {error && <p className="mt-1 text-xs text-clay">{error}</p>}
    </div>
  );
}

function OppForm({ start, canRead, onSave, onCancel }: { start: Fields; canRead: boolean; onSave: (f: Fields) => Promise<void>; onCancel: () => void }) {
  const { user } = useSession();
  const [f, setF] = useState(start);
  // Typed as text, so a decimal point or a comma can be typed; read as a number on save.
  const [value, setValue] = useState(start.value != null ? String(start.value) : "");
  const amount = value.trim() ? Number(value.replace(/,/g, "")) : null;
  const badValue = amount !== null && !(Number.isFinite(amount) && amount >= 0);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{
    ok: boolean;
    text: string;
    missing: string[];
  } | null>(null);
  const t = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const latest = useRef(f);
  latest.current = f;
  const hasCall = !!f.link.trim() || (f.documents ?? []).length > 0;
  // The fields come into view once there is a call to read, or the person chooses to type it all.
  const [byHand, setByHand] = useState(!!start.title);
  const show = byHand || hasCall;
  const [readLink, setReadLink] = useState(start.link);
  const httpsLink = (l: string) => (/^https:\/\/\S+\.\S+/i.test(l.trim()) ? l.trim() : "");

  // Reads the call and fills the form. What the person has already typed is kept.
  const read = async (link = f.link, documents = f.documents ?? []) => {
    if (!user) return;
    setReadLink(link);
    setReading(true);
    setReadNote(null);
    try {
      const res = await fetch("/api/opportunities", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-demo-user": user.id },
        body: JSON.stringify({
          action: "read",
          link: httpsLink(link),
          documents,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      const r = (body as { reading: CallReading }).reading;
      const filled: string[] = [];
      // From the latest form, not the one this reading started from: the person may have typed meanwhile.
      const next = { ...latest.current, link, documents };
      const fill = <K extends "title" | "donor" | "country" | "need" | "donorPriorities">(k: K, v: string, label: string) => {
        if (v.trim() && !String(next[k] ?? "").trim()) {
          next[k] = v.trim() as Fields[K];
          filled.push(label);
        }
      };
      fill("title", r.title, "name");
      fill("donor", r.donor, "funder");
      fill("country", r.country, "country");
      fill("donorPriorities", r.donorPriorities, "what the funder wants");
      fill("need", r.need, "the problem");
      if (r.deadline && !next.deadline) {
        next.deadline = r.deadline;
        filled.push("deadline");
      }
      if (r.value != null && !value.trim()) {
        setValue(String(r.value));
        filled.push("value");
      }
      if (r.currency && !value.trim()) next.currency = r.currency;
      setF(next);
      setReadNote({
        ok: true,
        text: filled.length ? `Filled in from the call: ${filled.join(", ")}. Check each one: it was read by AI. What you had typed is kept.` : "Nothing new to fill in: what you had typed is kept.",
        missing: r.missing,
      });
    } catch (e) {
      setReadNote({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
        missing: [],
      });
    } finally {
      setReading(false);
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (badValue) return;
        void onSave({ ...f, value: amount });
      }}
    >
      {/* Start from the call: its link or the document, then one button fills in the rest. */}
      <div className="space-y-3 rounded-xl bg-paper p-3 sm:col-span-2">
        <p className="text-sm font-semibold">Start from the call</p>
        <p className="text-xs text-muted">Add the link, the documents or both. {canRead ? "The app reads the call and fills in the rest for you to check." : "Then fill in the fields that appear."}</p>
        <label className="block text-sm">
          Link to the call
          <input
            className={input}
            value={f.link}
            placeholder="https://"
            onChange={t("link")}
            // Read once the link is complete, if it changed since the last reading.
            onBlur={() => {
              if (canRead && !reading && httpsLink(f.link) && f.link.trim() !== readLink.trim()) void read(f.link, f.documents ?? []);
            }}
          />
        </label>
        <DocumentsField
          docs={f.documents ?? []}
          onChange={(documents) => setF((cur) => ({ ...cur, documents }))}
          onAdded={(documents) => {
            if (canRead && !reading) void read(latest.current.link, documents);
          }}
        />
        {canRead ? (
          (reading || hasCall) && (
            <button type="button" className={quietBtn} disabled={!hasCall || reading} onClick={() => void read()}>
              {reading ? "Reading the call… (up to a minute)" : "Read the call again"}
            </button>
          )
        ) : (
          <p className="text-xs text-muted">Reading the call needs the AI assistant, which is not set up here.</p>
        )}
        {readNote && (
          <div role="status" className={`rounded-lg px-3 py-2 text-xs ${readNote.ok ? "bg-mist text-leaf" : "bg-ochre-soft text-ink"}`}>
            <p>{readNote.text}</p>
            {readNote.missing.length > 0 && (
              <ul className="mt-1 list-disc ps-4 text-ink">
                {readNote.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!show && (
        <p className="text-sm sm:col-span-2">
          <button type="button" className="font-semibold text-forest hover:underline" onClick={() => setByHand(true)}>
            No link or document? Fill it in by hand
          </button>
        </p>
      )}
      {show && (
        <>
          <label className="text-sm sm:col-span-2">
            Opportunity
            <input className={input} value={f.title} onChange={t("title")} required />
          </label>
          <label className="text-sm">
            Funder
            <input className={input} value={f.donor} onChange={t("donor")} required />
          </label>
          <label className="text-sm">
            Deadline
            <input type="date" className={input} value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value || null })} />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2 text-sm">
            <label>
              Value
              <input inputMode="decimal" className={input} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={badValue} />
            </label>
            <label>
              Currency
              <select className={input} value={f.currency} onChange={t("currency")}>
                {[...new Set([...CURRENCIES, f.currency])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {badValue && <span className="col-span-2 text-xs text-clay">Type the value as a number, like 1,500,000.</span>}
          </div>
          <label className="text-sm">
            Country
            <input className={input} value={f.country} onChange={t("country")} />
          </label>
          <label className="text-sm sm:col-span-2">
            What the funder wants
            <textarea rows={3} className={input} value={f.donorPriorities} onChange={t("donorPriorities")} />
          </label>
          <label className="text-sm sm:col-span-2">
            Your notes
            <textarea rows={3} className={input} value={f.notes ?? ""} onChange={t("notes")} />
          </label>
          <label className="text-sm sm:col-span-2">
            Contact with the funder
            <textarea rows={3} className={input} value={f.funderContact ?? ""} placeholder="Who you spoke to, when, and what they said. Leave empty if none yet." onChange={t("funderContact")} />
          </label>

          {/* The rest feeds the match brief; it can be filled in now or later. Open when editing one that has it. */}
          <details className="rounded-xl border border-line text-sm sm:col-span-2" open={!!(start.need || start.capacity || start.risks || (start.source && start.source !== "Donor call"))}>
            <summary className="cursor-pointer px-3 py-2.5 font-medium">More for the match brief (optional)</summary>
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <label className="text-sm">
                Where it came from
                <select className={input} value={f.source} onChange={t("source")}>
                  {SOURCES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["need", "The need or problem"],
                  ["capacity", "ROP's capacity: staff, presence, partners"],
                  ["risks", "Risks"],
                ] as [keyof Fields, string][]
              ).map(([k, label]) => (
                <label key={k} className="text-sm sm:col-span-2">
                  {label}
                  <textarea rows={3} className={input} value={String(f[k] ?? "")} onChange={t(k)} />
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2">
        {show && (
          <button type="submit" className={primaryBtn} disabled={badValue || reading}>
            Save
          </button>
        )}
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
        <span className="mt-1 block text-xs text-muted">{o.source}</span>
      </button>
    )),
  }));
  return <Board columns={columns} label="Donor pipeline" />;
}

function Card({ o, v, act }: { o: Opportunity; v: OpportunitiesView; act: (a: OppAction) => Promise<void> }) {
  const { user } = useSession();
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
        <StatusPill tone={st.tone}>{st.text}</StatusPill>
      </div>
      {(o.documents ?? []).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {(o.documents ?? []).map((d) => (
            <li key={d.hash}>
              <button type="button" className="rounded-lg bg-mist px-2.5 py-1.5 font-semibold text-forest hover:bg-sunken" title={d.label} onClick={() => user && void openReceipt(d.hash, user.id)}>
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <div className="mt-3">
          <OppForm start={o} canRead={v.can.brief} onCancel={() => setEditing(false)} onSave={(fields) => act({ action: "edit", id: o.id, fields }).then(() => setEditing(false))} />
        </div>
      ) : (
        <>
          {b ? (
            <div className="mt-3 space-y-1.5 rounded-xl bg-paper p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Match brief (AI draft, {b.at}): check it before the call</p>
              {b.fromDocuments && (
                <p>
                  <span className="font-semibold">From the call documents: </span>
                  {b.fromDocuments}
                </p>
              )}
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
          {(o.notes || o.funderContact) && (
            <div className="mt-2 space-y-1 text-sm">
              {o.notes && (
                <p>
                  <span className="font-semibold">Notes: </span>
                  {o.notes}
                </p>
              )}
              {o.funderContact && (
                <p>
                  <span className="font-semibold">Contact with the funder: </span>
                  {o.funderContact}
                </p>
              )}
            </div>
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
            {/* After a match the next step is the proposal; the project is set up once the award comes,
                from the won proposal when there is one (server/project-origin): the same entry as on the proposal. */}
            {o.status === "match" && opensProposals(user) && (
              <Link href={`/work/proposals?opportunity=${encodeURIComponent(o.id)}`} className={primaryBtn}>
                Start the proposal
              </Link>
            )}
            {o.status === "match" && (
              <Link href={`/setup?new=1&opportunity=${encodeURIComponent(o.id)}`} className={opensProposals(user) ? quietBtn : primaryBtn}>
                Set up the project (after award)
              </Link>
            )}
            {(o.status === "match" || o.status === "no_match") && v.can.decide && (
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={async () => {
                  // Cancel means do not reopen: before, it reopened with an empty reason.
                  const reason = await askReason({
                    message: "Why reopen it?",
                    confirm: "Reopen",
                  });
                  if (reason) void act({ action: "reopen", id: o.id, reason });
                }}
              >
                Reopen
              </button>
            )}
          </div>
          {deciding !== null && (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act({
                  action: "decide",
                  id: o.id,
                  match: deciding,
                  reason,
                }).then(() => setDeciding(null));
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
                placeholder={deciding ? "Why it is a match" : "Why not: kept so the next similar call learns from it"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button type="submit" className={primaryBtn} disabled={reason.trim().length < 10}>
                {deciding ? "Record match" : "Record no match"}
              </button>
              {reason.trim().length < 10 && <p className="w-full text-xs text-muted">Write a sentence on why, to record it.</p>}
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
        <Link href="/project" className="text-sm text-muted hover:text-ink">
          ← Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">Opportunities</h1>
          {v && v.items.length > 0 && <ViewSwitch value={view} onChange={setView} />}
          {v && <TrackRecordButton user={user.id} />}
          {/* Stays in place while the form is open: when it went, the button beside it slid under the pointer. */}
          {v?.can.add && (
            <button type="button" className={primaryBtn} disabled={adding} onClick={() => setAdding(true)}>
              + Record an opportunity
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">Record funding calls, check if they fit ROP, and decide yes or no.</p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {adding && (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <OppForm start={EMPTY} canRead={!!v?.can.brief} onCancel={() => setAdding(false)} onSave={(fields) => act({ action: "add", fields }).then(() => setAdding(false))} />
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
