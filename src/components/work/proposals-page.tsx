"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import {
  BANDS,
  BAND_HELP,
  BAND_LABEL,
  KINDS,
  KIND_HELP,
  KIND_LABEL,
  NO_BUDGET,
  OUTCOME_LABEL,
  STATUSES,
  STATUS_LABEL,
  byPerson,
  hoursLeft,
  isDone,
  placeOf,
  sayMoment,
  uploadPlan,
  type Band,
  type HeadFields,
  type Item,
  type ItemFields,
  type ProposalAction,
  type Status,
} from "@/lib/funding-proposals";
import { ROLE_LABEL } from "@/lib/hr";
import type { ProposalsView } from "@/server/funding-proposals-store";

/**
 * Proposals: from a matched opportunity to submitted. One screen per proposal answers two
 * questions and keeps them apart: can it be submitted (every checkbox item final, every decision
 * made, the budget inside the limits), and how would it stand (the band of its scored sections).
 */

type P = ProposalsView["items"][number];
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const BAND_TONE: Record<Band, "forest" | "sky" | "ochre" | "clay"> = { differentiator: "forest", competitive: "sky", fringe: "ochre", not_competitive: "clay" };
const STATUS_TONE: Record<Status, "muted" | "ochre" | "sky" | "plum" | "forest"> = { todo: "muted", drafting: "ochre", review: "sky", sign: "plum", final: "forest", na: "muted" };
const KIND_TONE = { checkbox: "muted", scored: "sky", decision: "plum" } as const;
const ZONES = ["Asia/Kabul", "America/Los_Angeles", "America/New_York", "America/Guatemala", "Europe/Brussels", "Europe/London", "Asia/Ho_Chi_Minh", "UTC"];
const here = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function call(user: string, init?: RequestInit): Promise<ProposalsView> {
  const res = await fetch("/api/proposals", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as ProposalsView;
}

const EMPTY_HEAD: HeadFields = { title: "", donor: "", portal: "", folder: "", currency: "USD", deadline: null, targets: [], rules: [], budget: NO_BUDGET };
const EMPTY_ITEM: ItemFields = { ref: "", title: "", kind: "checkbox", owner: null, signer: null, due: null, todo: "", working: "", final: "", points: null, criteria: "", guidance: "", upload: null };
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

function HeadForm({ start, onSave, onCancel, extra }: { start: HeadFields; onSave: (f: HeadFields) => Promise<void>; onCancel: () => void; extra?: React.ReactNode }) {
  const [f, setF] = useState(start);
  const [rules, setRules] = useState(start.rules.join("\n"));
  const [targets, setTargets] = useState(start.targets.length ? start.targets : []);
  const b = f.budget;
  const money = (k: keyof typeof b) => (
    <input className={input} inputMode="decimal" value={b[k] ?? ""} onChange={(e) => setF({ ...f, budget: { ...b, [k]: num(e.target.value) } })} />
  );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ ...f, rules: rules.split("\n").map((x) => x.trim()).filter((x) => x.length > 1), targets: targets.filter((t) => t.label.trim().length > 1 && t.at) });
      }}
    >
      <label className="text-sm sm:col-span-2">
        Proposal
        <input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
      </label>
      <label className="text-sm">
        Donor
        <input className={input} value={f.donor} onChange={(e) => setF({ ...f, donor: e.target.value })} required />
      </label>
      <label className="text-sm">
        Currency
        <input className={input} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 5) })} />
      </label>
      {extra}
      <label className="text-sm">
        Donor&rsquo;s deadline (on the donor&rsquo;s clock)
        <input className={input} type="datetime-local" value={f.deadline?.at ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value ? { at: e.target.value, zone: f.deadline?.zone ?? ZONES[0] } : null })} />
      </label>
      <label className="text-sm">
        Time zone of the deadline
        <select className={input} value={f.deadline?.zone ?? ZONES[0]} disabled={!f.deadline} onChange={(e) => f.deadline && setF({ ...f, deadline: { ...f.deadline, zone: e.target.value } })}>
          {[...new Set([...(f.deadline ? [f.deadline.zone] : []), ...ZONES])].map((z) => (
            <option key={z} value={z}>
              {placeOf(z)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="text-sm sm:col-span-2">
        <legend>Our own targets before the deadline, on the donor&rsquo;s clock</legend>
        {targets.map((t, k) => (
          <div key={k} className="mt-1 flex flex-wrap gap-2">
            <input className={`${input} min-w-0 flex-1`} aria-label="Target" placeholder="Final files in the submission folder" value={t.label} onChange={(e) => setTargets(targets.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
            <input className={`${input} w-auto`} aria-label="When" type="datetime-local" value={t.at} onChange={(e) => setTargets(targets.map((x, j) => (j === k ? { ...x, at: e.target.value } : x)))} />
          </div>
        ))}
        {targets.length < 6 && (
          <button type="button" className="mt-2 text-sm font-semibold text-forest hover:underline" onClick={() => setTargets([...targets, { label: "", at: f.deadline?.at ?? "" }])}>
            + Add a target
          </button>
        )}
      </fieldset>
      <label className="text-sm">
        Where it is submitted (link)
        <input className={input} value={f.portal} onChange={(e) => setF({ ...f, portal: e.target.value })} placeholder="The donor's portal" />
      </label>
      <label className="text-sm">
        The team&rsquo;s shared folder (link)
        <input className={input} value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} placeholder="SharePoint or OneDrive" />
      </label>
      <fieldset className="grid gap-3 rounded-xl border border-line p-3 text-sm sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1">The call&rsquo;s budget limits, and where the budget stands. Leave empty what the call does not set.</legend>
        <label>Ceiling{money("ceiling")}</label>
        <label>Support costs, limit in % of total{money("supportCap")}</label>
        <label>Indirect costs, limit in % of direct{money("indirectCap")}</label>
        <label>Budget total now{money("total")}</label>
        <label>Of which support costs{money("support")}</label>
        <label>Direct costs{money("direct")}</label>
        <label>Indirect costs{money("indirect")}</label>
      </fieldset>
      <label className="text-sm sm:col-span-2">
        How we work until submission, one rule per line
        <textarea className={input} rows={3} value={rules} onChange={(e) => setRules(e.target.value)} placeholder={"Edit files in the shared folder, not in downloaded copies.\nNever delete: old versions go to the archive folder."} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className={primaryBtn}>Save</button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemForm({ start, people, onSave, onCancel }: { start: ItemFields; people: { id: string; name: string }[]; onSave: (f: ItemFields) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(start);
  const set = (k: keyof ItemFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const who = (k: "owner" | "signer", none: string) => (
    <select className={input} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value || null })}>
      <option value="">{none}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
  return (
    <form
      className="grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(f);
      }}
    >
      <label className="text-sm">
        Where the call asks for it
        <input className={input} value={f.ref} onChange={set("ref")} placeholder="Annex I, Section 3.2" />
      </label>
      <label className="text-sm">
        Item
        <input className={input} value={f.title} onChange={set("title")} required />
      </label>
      <fieldset className="text-sm sm:col-span-2">
        <legend>What kind of item is it?</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label key={k} className={`cursor-pointer rounded-xl border p-3 ${f.kind === k ? "border-forest bg-mist" : "border-line"}`}>
              <input type="radio" name="kind" className="me-2" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} />
              <span className="font-semibold">{KIND_LABEL[k]}</span>
              <span className="mt-1 block text-xs text-muted">{KIND_HELP[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-sm">
        Owner
        {who("owner", "Nobody yet")}
      </label>
      <label className="text-sm">
        Signed by, when someone must sign
        {who("signer", "No signature needed")}
      </label>
      <label className="text-sm">
        Due inside the team
        <input className={input} type="date" value={f.due ?? ""} onChange={(e) => setF({ ...f, due: e.target.value || null })} />
      </label>
      <label className="text-sm">
        Place in the upload order
        <input className={input} inputMode="numeric" value={f.upload ?? ""} onChange={(e) => setF({ ...f, upload: num(e.target.value) })} placeholder="Empty if it is not a file to upload" />
      </label>
      <label className="text-sm sm:col-span-2">
        What to do
        <textarea className={input} rows={2} value={f.todo} onChange={set("todo")} />
      </label>
      <label className="text-sm">
        Working file
        <input className={input} value={f.working} onChange={set("working")} placeholder="07.03" />
      </label>
      <label className="text-sm">
        Save the final as
        <input className={input} value={f.final} onChange={set("final")} placeholder="13.06a" />
      </label>
      {f.kind === "scored" && (
        <>
          <label className="text-sm">
            Most points in the grid
            <input className={input} inputMode="decimal" value={f.points ?? ""} onChange={(e) => setF({ ...f, points: num(e.target.value) })} />
          </label>
          <span />
          <label className="text-sm sm:col-span-2">
            What the grid asks for
            <textarea className={input} rows={3} value={f.criteria} onChange={set("criteria")} placeholder="In the call's own words." />
          </label>
          <label className="text-sm sm:col-span-2">
            What earns the best score, against our win themes
            <textarea className={input} rows={3} value={f.guidance} onChange={set("guidance")} placeholder="The evidence and the detail the writer should bring." />
          </label>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button className={primaryBtn}>Save item</button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemRow({ p, i, v, me, act, busy }: { p: P; i: Item; v: ProposalsView; me: string; act: (a: ProposalAction) => Promise<void>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<{ band: Band; why: string; next: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const name = (id: string | null) => (id ? (v.names[id] ?? id) : "nobody yet");
  const live = p.outcome === "drafting";
  const mayStatus = live && (v.can.run || i.owner === me || i.signer === me);
  const people = [...(v.core?.members ?? []), ...p.team.map((id) => ({ id, name: v.names[id] ?? id })), ...p.outside.map((o) => ({ id: o.id, name: v.names[o.id] ?? o.name }))];
  // The statuses this person can pick: a signed item is made final by its signer only.
  const choices = STATUSES.filter((s) => s === i.status || ((s !== "final" || !i.signer || i.signer === me) && (s !== "sign" || !!i.signer)));
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        <button type="button" className="min-w-0 flex-1 text-start" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="flex flex-wrap items-center gap-2">
            {i.ref && <span className="text-xs font-semibold text-muted">{i.ref}</span>}
            <span className={`font-medium ${isDone(i) ? "text-muted" : ""}`}>{i.title}</span>
            <Pill tone={KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Pill>
            {i.unchecked && <Pill tone="ochre">Check: drafted from the call</Pill>}
            {i.rating && <Pill tone={i.rating.suggested ? "muted" : BAND_TONE[i.rating.band]}>{i.rating.suggested ? `AI suggests ${BAND_LABEL[i.rating.band].toLowerCase()}` : BAND_LABEL[i.rating.band]}</Pill>}
          </span>
          <span className="mt-1 block text-sm text-muted">
            {name(i.owner)}
            {i.signer && i.signer !== i.owner ? `, signed by ${name(i.signer)}` : ""}
            {i.due ? ` · due ${i.due}` : ""}
            {i.working || i.final ? ` · ${i.working || "?"} → ${i.final || "?"}` : ""}
          </span>
        </button>
        {mayStatus ? (
          <select aria-label={`Status of ${i.title}`} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" value={i.status} disabled={busy} onChange={(e) => void act({ action: "status", id: p.id, item: i.id, status: e.target.value as Status, note: "" })}>
            {choices.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        ) : (
          <Pill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill>
        )}
      </div>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm">
          {editing ? (
            <ItemForm start={i} people={people} onCancel={() => setEditing(false)} onSave={(fields) => act({ action: "editItem", id: p.id, item: i.id, fields }).then(() => setEditing(false))} />
          ) : (
            <>
              {i.todo && (
                <p>
                  <span className="font-semibold">What to do: </span>
                  {i.todo}
                </p>
              )}
              {i.kind === "scored" && (
                <div className="space-y-2 rounded-xl bg-paper p-3">
                  <p>
                    <span className="font-semibold">What the grid asks for{i.points != null ? ` (up to ${i.points} points)` : ""}: </span>
                    {i.criteria || "Not written yet. A rating needs it."}
                  </p>
                  <p>
                    <span className="font-semibold">What earns the best score: </span>
                    {i.guidance || "Not written yet."}
                  </p>
                  {p.themes.length > 0 && (
                    <p className="text-muted">
                      <span className="font-semibold text-ink">Our win themes: </span>
                      {p.themes.join(" · ")}
                    </p>
                  )}
                  {i.rating && (
                    <div className="rounded-lg border border-line bg-surface p-3">
                      <p className="font-semibold">
                        {i.rating.suggested ? "Suggested by AI, not counted until a reviewer confirms it: " : `Rated by ${i.rating.byName} on ${i.rating.at}: `}
                        {BAND_LABEL[i.rating.band]}
                      </p>
                      <p className="mt-1">{i.rating.why}</p>
                      {i.rating.next && (
                        <p className="mt-1">
                          <span className="font-semibold">To move it up: </span>
                          {i.rating.next}
                        </p>
                      )}
                    </div>
                  )}
                  {live && v.can.run && i.owner === me && <p className="text-muted">You wrote this section, so someone else rates it.</p>}
                  {live && v.can.run && i.owner !== me && !rating && draft === null && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={quietBtn} onClick={() => setRating(i.rating ? { band: i.rating.band, why: i.rating.why, next: i.rating.next } : { band: "competitive", why: "", next: "" })}>
                        {i.rating?.suggested ? "Confirm or change the rating" : i.rating ? "Rate again" : "Rate this section"}
                      </button>
                      {v.can.ai && (
                        <button type="button" className={quietBtn} onClick={() => setDraft("")}>
                          Ask AI for a first rating
                        </button>
                      )}
                    </div>
                  )}
                  {rating && (
                    <form
                      className="grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act({ action: "rate", id: p.id, item: i.id, ...rating }).then(() => setRating(null));
                      }}
                    >
                      <fieldset>
                        <legend className="font-semibold">Against other applicants, this section is:</legend>
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          {BANDS.map((b) => (
                            <label key={b} className={`cursor-pointer rounded-xl border p-3 ${rating.band === b ? "border-forest bg-mist" : "border-line bg-surface"}`}>
                              <input type="radio" name={`band-${i.id}`} className="me-2" checked={rating.band === b} onChange={() => setRating({ ...rating, band: b })} />
                              <span className="font-semibold">{BAND_LABEL[b]}</span>
                              <span className="mt-1 block text-xs text-muted">{BAND_HELP[b]}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label>
                        Why
                        <textarea className={input} rows={2} value={rating.why} onChange={(e) => setRating({ ...rating, why: e.target.value })} required minLength={10} />
                      </label>
                      <label>
                        What would move it up a band
                        <textarea className={input} rows={2} value={rating.next} onChange={(e) => setRating({ ...rating, next: e.target.value })} />
                      </label>
                      <div className="flex gap-2">
                        <button className={primaryBtn} disabled={busy}>
                          Confirm the rating
                        </button>
                        <button type="button" className={quietBtn} onClick={() => setRating(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  {draft !== null && (
                    <form
                      className="grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act({ action: "assess", id: p.id, item: i.id, text: draft }).then(() => setDraft(null));
                      }}
                    >
                      <label>
                        Paste the section&rsquo;s draft. AI reads it against what the grid asks for and suggests a band; a reviewer confirms it.
                        <textarea className={input} rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} required minLength={200} />
                      </label>
                      <div className="flex gap-2">
                        <button className={primaryBtn} disabled={busy}>
                          {busy ? "Reading…" : "Suggest a rating"}
                        </button>
                        <button type="button" className={quietBtn} onClick={() => setDraft(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
              {live && v.can.run && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={quietBtn} onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button type="button" className={quietBtn} disabled={busy} onClick={() => confirm(`Remove "${i.title}" from this proposal?`) && void act({ action: "removeItem", id: p.id, item: i.id })}>
                    Remove
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({ p, v, me, act, busy }: { p: P; v: ProposalsView; me: string; act: (a: ProposalAction) => Promise<void>; busy: boolean }) {
  const [view, setView] = useState<"person" | "call" | "upload">("person");
  const [panel, setPanel] = useState<"" | "head" | "item" | "themes" | "call" | "team" | "submit">("");
  const [themes, setThemes] = useState(p.themes.join("\n"));
  const [callText, setCallText] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [addPerson, setAddPerson] = useState("");
  const [out, setOut] = useState({ name: "", org: "", email: "" });
  const r = p.readiness;
  const live = p.outcome === "drafting";
  const zone = useMemo(here, []);
  const left = p.deadline ? hoursLeft(p.deadline, new Date()) : null;
  const name = (id: string | null) => (id ? (v.names[id] ?? id) : "Nobody yet");
  const people = [...(v.core?.members ?? []), ...p.team.map((id) => ({ id, name: v.names[id] ?? id })), ...p.outside.map((o) => ({ id: o.id, name: v.names[o.id] ?? o.name }))];
  const row = (i: Item) => <ItemRow key={i.id} p={p} i={i} v={v} me={me} act={act} busy={busy} />;
  const close = () => setPanel("");

  return (
    <div className="space-y-5">
      <div>
        <Link href="/work/proposals" className="text-sm font-semibold text-forest hover:underline">
          ← All proposals
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl">{p.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {p.donor}
              {p.deadline ? ` · Deadline ${sayMoment(p.deadline, zone)}` : " · No deadline set"}
              {live && left != null ? (left < 0 ? " · the deadline has passed" : left < 72 ? ` · ${left} hours left` : ` · ${Math.floor(left / 24)} days left`) : ""}
            </p>
            {p.targets.length > 0 && p.deadline && (
              <p className="mt-1 text-sm text-muted">
                {p.targets.map((t) => `${t.label}: ${sayMoment({ at: t.at, zone: p.deadline!.zone }, zone)}`).join(" · ")}
              </p>
            )}
            <p className="mt-1 flex flex-wrap gap-3 text-sm">
              {p.folder && (
                <a className="font-semibold text-forest hover:underline" href={p.folder} target="_blank" rel="noreferrer">
                  Shared folder ↗
                </a>
              )}
              {p.portal && (
                <a className="font-semibold text-forest hover:underline" href={p.portal} target="_blank" rel="noreferrer">
                  Donor&rsquo;s portal ↗
                </a>
              )}
            </p>
          </div>
          <Pill tone={p.outcome === "drafting" ? "ochre" : p.outcome === "won" ? "forest" : p.outcome === "submitted" ? "sky" : "muted"}>{OUTCOME_LABEL[p.outcome]}</Pill>
        </div>
      </div>

      {live && (
        <section className="rounded-2xl border border-forest/40 bg-mist p-4" aria-live="polite">
          <SectionLabel>Next step</SectionLabel>
          <p className="mt-1 text-lg font-medium">{r.next}</p>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <SectionLabel>Can it be submitted?</SectionLabel>
          <p className="mt-1 text-lg font-medium">{r.blockers.length ? "Not yet" : "Yes"}</p>
          <p className="text-sm text-muted">
            {r.checks.done} of {r.checks.of} checkbox items final{r.decisions.length ? ` · ${r.decisions.length} decision${r.decisions.length === 1 ? "" : "s"} open` : ""}
          </p>
          {r.blockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
              {r.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <SectionLabel>How would it stand?</SectionLabel>
          <p className="mt-1 text-lg font-medium">{r.scored.band ? `${BAND_LABEL[r.scored.band]}${r.scored.rated < r.scored.of ? ", on the sections rated so far" : ""}` : r.scored.of ? "Not rated yet" : "Nothing in this call is scored"}</p>
          <p className="text-sm text-muted">
            {r.scored.rated} of {r.scored.of} scored sections rated by a reviewer{r.scored.suggested ? ` · ${r.scored.suggested} with an AI suggestion to confirm` : ""}. A band, not a score: it weighs each section by its points in the grid.
          </p>
          {r.scored.weakest.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Weakest, most points first: </span>
              {r.scored.weakest.slice(0, 3).map((i) => `${i.title} (${BAND_LABEL[i.rating!.band].toLowerCase()})`).join("; ")}
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Win themes</SectionLabel>
          {live && v.can.run && panel !== "themes" && (
            <button type="button" className="text-sm font-semibold text-forest hover:underline" onClick={() => setPanel("themes")}>
              {p.themes.length ? "Change" : "Choose"}
            </button>
          )}
        </div>
        {panel === "themes" ? (
          <form
            className="mt-2 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "themes", id: p.id, themes: themes.split("\n").map((x) => x.trim()).filter((x) => x.length > 2).slice(0, 3) }).then(close);
            }}
          >
            <label className="text-sm">
              Up to three reasons to choose us over the other applicants, one per line. Scored sections are written and rated against them.
              <textarea className={input} rows={3} value={themes} onChange={(e) => setThemes(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button className={primaryBtn} disabled={busy}>
                Save
              </button>
              <button type="button" className={quietBtn} onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        ) : p.themes.length ? (
          <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">
            {p.themes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">None chosen yet. Without them the scored sections have nothing to be written against.</p>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full border border-line p-1 text-sm" role="tablist" aria-label="How the items are listed">
            {(
              [
                ["person", "By person"],
                ["call", "By the call"],
                ["upload", "Upload order"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={`rounded-full px-3 py-1.5 ${view === k ? "bg-forest font-semibold text-forest-ink" : "text-muted"}`} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
          </div>
          {live && v.can.run && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quietBtn} onClick={() => setPanel(panel === "item" ? "" : "item")}>
                + Add an item
              </button>
              <button type="button" className={quietBtn} onClick={() => setPanel(panel === "call" ? "" : "call")}>
                Build the list from the call
              </button>
            </div>
          )}
        </div>

        {panel === "item" && (
          <div className="mt-3">
            <ItemForm start={EMPTY_ITEM} people={people} onCancel={close} onSave={(fields) => act({ action: "addItem", id: p.id, fields }).then(close)} />
          </div>
        )}
        {panel === "call" && (
          <form
            className="mt-3 grid gap-2 rounded-xl bg-paper p-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "plan", id: p.id, call: callText }).then(() => {
                setCallText("");
                close();
              });
            }}
          >
            {v.can.ai ? (
              <>
                <label>
                  Paste the part of the call that says what to submit and how it is scored. AI lists each item, marks it checkbox, scored or decision, and writes what would earn the best score against your win themes. Every item it adds is marked for a person to check.
                  <textarea className={input} rows={10} value={callText} onChange={(e) => setCallText(e.target.value)} required minLength={400} />
                </label>
                {!p.themes.length && <p className="text-warn">Choose the win themes first if you can: the notes on scored sections are written against them.</p>}
                <div className="flex gap-2">
                  <button className={primaryBtn} disabled={busy}>
                    {busy ? "Reading the call…" : "List what the call requires"}
                  </button>
                  <button type="button" className={quietBtn} onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p>AI drafting is not switched on here (it needs ANTHROPIC_API_KEY on the server). Add the items by hand, or start a proposal from the standard list or from an earlier one.</p>
            )}
          </form>
        )}

        <div className="mt-3 space-y-4">
          {!p.items.length && <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Nothing is listed yet.</p>}
          {view === "person" &&
            byPerson(p).map((g) => (
              <div key={g.person ?? "nobody"} className="rounded-2xl border border-line bg-surface">
                <h3 className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 font-medium">
                  <span>{g.person === me ? `${name(g.person)} (you)` : name(g.person)}</span>
                  <span className="text-sm font-normal text-muted">
                    {g.items.length} open{g.toSign.length ? ` · ${g.toSign.length} to sign` : ""}
                  </span>
                </h3>
                <ul className="mt-1">{[...g.toSign, ...g.items].map(row)}</ul>
              </div>
            ))}
          {view === "person" && p.items.some(isDone) && (
            <details className="rounded-2xl border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Final, no action needed ({p.items.filter(isDone).length})
              </summary>
              <ul>{p.items.filter(isDone).map(row)}</ul>
            </details>
          )}
          {view === "call" && p.items.length > 0 && <ul className="rounded-2xl border border-line bg-surface">{p.items.map(row)}</ul>}
          {view === "upload" &&
            (uploadPlan(p).length ? (
              <ol className="rounded-2xl border border-line bg-surface">
                {uploadPlan(p).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm first:border-t-0">
                    <span className="w-6 font-semibold text-muted">{i.upload}</span>
                    <span className="min-w-0 flex-1">
                      {i.final ? <span className="font-semibold">{i.final} </span> : null}
                      {i.title}
                    </span>
                    <Pill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">No item has a place in the upload order yet. Give each file to upload a number when you edit it.</p>
            ))}
        </div>
      </section>

      {p.rules.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <SectionLabel>How we work until submission, and the call&rsquo;s limits</SectionLabel>
          <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">
            {p.rules.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <SectionLabel>Who is on this proposal</SectionLabel>
        <p className="mt-2 text-sm text-muted">The people your organization has named to start proposals open every one. Anyone else can be added here, from inside the organization or outside it, and then sees this proposal only.</p>
        <ul className="mt-2 space-y-1 text-sm">
          {p.team.map((id) => (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{v.names[id] ?? id}</span>
              {live && v.can.run && (
                <button type="button" className="text-muted hover:text-clay hover:underline" disabled={busy} onClick={() => void act({ action: "team", id: p.id, person: id, add: false })}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {p.outside.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {o.name}
                <span className="text-muted">
                  {o.org ? `, ${o.org}` : ""} · outside the organization, no sign-in{o.email ? ` · ${o.email}` : ""}
                </span>
              </span>
              {live && v.can.run && (
                <button type="button" className="text-muted hover:text-clay hover:underline" disabled={busy} onClick={() => void act({ action: "team", id: p.id, person: o.id, add: false })}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {!p.team.length && !p.outside.length && <li className="text-muted">Nobody has been added yet.</li>}
        </ul>
        {live && v.can.run && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Colleague to add to this proposal" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={addPerson} onChange={(e) => setAddPerson(e.target.value)}>
                <option value="">Add a colleague…</option>
                {v.others
                  .filter((o) => !p.team.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}, {o.title}
                    </option>
                  ))}
              </select>
              <button type="button" className={quietBtn} disabled={busy || !addPerson} onClick={() => void act({ action: "team", id: p.id, person: addPerson, add: true }).then(() => setAddPerson(""))}>
                Add
              </button>
            </div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "outsider", id: p.id, ...out }).then(() => setOut({ name: "", org: "", email: "" }));
              }}
            >
              <input aria-label="Name of someone outside the organization" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="Someone outside: name" value={out.name} onChange={(e) => setOut({ ...out, name: e.target.value })} required minLength={2} />
              <input aria-label="Their organization or role" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="Organization or role" value={out.org} onChange={(e) => setOut({ ...out, org: e.target.value })} />
              <input aria-label="Their email" type="email" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="Email (optional)" value={out.email} onChange={(e) => setOut({ ...out, email: e.target.value })} />
              <button className={quietBtn} disabled={busy}>
                Add
              </button>
            </form>
          </div>
        )}
        {live && v.can.run && p.outside.length > 0 && <p className="mt-2 text-xs text-muted">Someone outside has no sign-in, so you update the status of their items for them.</p>}
      </section>

      {v.can.run && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap gap-2">
            {live && (
              <button type="button" className={quietBtn} onClick={() => setPanel(panel === "head" ? "" : "head")}>
                Deadline, budget limits and links
              </button>
            )}
            {live && v.can.run && (
              <button type="button" className={primaryBtn} disabled={r.blockers.length > 0} onClick={() => setPanel("submit")}>
                Record it as submitted
              </button>
            )}
            {v.can.run && p.outcome === "submitted" && (
              <>
                <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "outcome", id: p.id, outcome: "won", confirmation: "", note: "" })}>
                  Won
                </button>
                <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "outcome", id: p.id, outcome: "lost", confirmation: "", note: "" })}>
                  Not funded
                </button>
              </>
            )}
            {v.can.run && live && (
              <button type="button" className={quietBtn} disabled={busy} onClick={() => confirm("Withdraw this proposal? It is kept, and can be reopened.") && void act({ action: "outcome", id: p.id, outcome: "withdrawn", confirmation: "", note: "" })}>
                Withdraw
              </button>
            )}
            {v.can.run && !live && (
              <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "outcome", id: p.id, outcome: "drafting", confirmation: "", note: "Reopened" })}>
                Reopen
              </button>
            )}
          </div>
          {live && v.can.run && r.blockers.length > 0 && <p className="mt-2 text-sm text-muted">It can be recorded as submitted once nothing above stops it.</p>}
          {panel === "head" && (
            <div className="mt-3">
              <HeadForm start={{ title: p.title, donor: p.donor, portal: p.portal, folder: p.folder, currency: p.currency, deadline: p.deadline, targets: p.targets, rules: p.rules, budget: p.budget }} onCancel={close} onSave={(fields) => act({ action: "head", id: p.id, fields }).then(close)} />
            </div>
          )}
          {panel === "submit" && (
            <form
              className="mt-3 grid gap-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "outcome", id: p.id, outcome: "submitted", confirmation, note: "" }).then(close);
              }}
            >
              <label>
                Where the donor&rsquo;s confirmation of receipt is saved
                <input className={input} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required placeholder="13.99 in the shared folder" />
              </label>
              <div className="flex gap-2">
                <button className={primaryBtn} disabled={busy}>
                  Submitted
                </button>
                <button type="button" className={quietBtn} onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {p.confirmation && <p className="mt-2 text-sm">Confirmation of receipt: {p.confirmation}</p>}
        </section>
      )}

      <details className="rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">History ({p.history.length})</summary>
        <ul className="px-4 pb-3 text-sm text-muted">
          {[...p.history].reverse().map((h, k) => (
            <li key={k} className="py-0.5">
              {h.at} · {h.byName}: {h.what}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const ROLE_CHOICES = ["ceo", "management", "technical", "cfo", "finance", "mel", "compliance"] as const;

/** Who can start proposals: each organization sets its own core, by role type, by name, or both. */
function CorePanel({ v, act, busy }: { v: ProposalsView; act: (a: ProposalAction) => Promise<void>; busy: boolean }) {
  const core = v.core!;
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<string[]>(core.roles);
  const [people, setPeople] = useState<string[]>(core.people);
  const [add, setAdd] = useState("");
  const everyone = [...core.members, ...v.others];
  return (
    <details className="mt-5 rounded-2xl border border-line bg-surface" open={editing}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Who can start proposals ({core.members.length})</summary>
      <div className="space-y-3 px-4 pb-4 text-sm">
        <p className="text-muted">These people can start a proposal, and see and run every one. Anyone else is added to a proposal as a contributor.</p>
        {!editing ? (
          <>
            <ul className="space-y-1">
              {core.members.map((m) => (
                <li key={m.id}>
                  {m.name}
                  <span className="text-muted">
                    , {m.title} · {m.why}
                  </span>
                </li>
              ))}
            </ul>
            {v.can.setCore ? (
              <button type="button" className={quietBtn} onClick={() => setEditing(true)}>
                Change
              </button>
            ) : (
              <p className="text-muted">The executive head or an administrator changes this.</p>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "core", roles: roles as (typeof ROLE_CHOICES)[number][], people }).then(() => setEditing(false));
            }}
          >
            <fieldset>
              <legend className="font-semibold">Everyone who holds one of these role types</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {ROLE_CHOICES.map((r) => (
                  <label key={r}>
                    <input type="checkbox" className="me-1" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                    {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-semibold">And these people by name</legend>
              <ul className="mt-1 space-y-1">
                {people.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span>{v.names[id] ?? id}</span>
                    <button type="button" className="text-muted hover:text-clay hover:underline" onClick={() => setPeople(people.filter((x) => x !== id))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex flex-wrap gap-2">
                <select aria-label="Person to name" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2" value={add} onChange={(e) => setAdd(e.target.value)}>
                  <option value="">Name a person…</option>
                  {everyone
                    .filter((x) => !people.includes(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}, {x.title}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className={quietBtn}
                  disabled={!add}
                  onClick={() => {
                    setPeople([...people, add]);
                    setAdd("");
                  }}
                >
                  Name them
                </button>
              </div>
            </fieldset>
            <div className="flex gap-2">
              <button className={primaryBtn} disabled={busy}>
                Save
              </button>
              <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export function ProposalsPage() {
  const { user, ready } = useRequireUser();
  const open = useSearchParams().get("open");
  const fromOpp = useSearchParams().get("opportunity");
  const [v, setV] = useState<ProposalsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState("standard");
  const [opp, setOpp] = useState("");
  const zone = useMemo(here, []);

  const load = useCallback(() => {
    if (!user) return;
    call(user.id)
      .then((x) => {
        setV(x);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  useEffect(load, [load]);
  // Arriving from a matched opportunity: open the form with it chosen.
  useEffect(() => {
    if (fromOpp && v?.matched.some((m) => m.id === fromOpp)) {
      setOpp(fromOpp);
      setAdding(true);
    }
  }, [fromOpp, v]);

  const act = async (a: ProposalAction) => {
    if (!user) return;
    setBusy(true);
    try {
      setV(await call(user.id, { method: "POST", body: JSON.stringify(a) }));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const safe = (a: ProposalAction) => act(a).catch(() => {});

  if (!ready || !user) return null;
  const current = v?.items.find((p) => p.id === open);
  const chosen = v?.matched.find((m) => m.id === opp);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {!current && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl">Proposals</h1>
              <p className="mt-1 text-sm text-muted">From a matched opportunity to submitted: what the call requires, who owns each item, and how it would score.</p>
            </div>
            {v?.can.run && !adding && (
              <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
                + New proposal
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-clay/40 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}

        {v && current && (
          <div className="mt-2">
            <Detail p={current} v={v} me={user.id} act={safe} busy={busy} />
          </div>
        )}

        {v && !current && (
          <>
            {open && <p className="mt-4 text-sm text-muted">That proposal is not one you can open.</p>}
            {v.core && <CorePanel v={v} act={safe} busy={busy} />}
            {adding && (
              <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
                <h2 className="font-medium">New proposal</h2>
                <div className="mt-3">
                  <HeadForm
                    key={opp}
                    start={{ ...EMPTY_HEAD, title: chosen?.title ?? "", donor: chosen?.donor ?? "" }}
                    onCancel={() => setAdding(false)}
                    onSave={(fields) =>
                      act({ action: "create", fields, opportunityId: opp || null, from })
                        .then(() => setAdding(false))
                        .catch(() => {})
                    }
                    extra={
                      <>
                        <label className="text-sm">
                          From which matched opportunity
                          <select className={input} value={opp} onChange={(e) => setOpp(e.target.value)}>
                            <option value="">None: it did not come through Opportunities</option>
                            {v.matched.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.title} · {m.donor}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          Start the list from
                          <select className={input} value={from} onChange={(e) => setFrom(e.target.value)}>
                            <option value="standard">The standard donor package</option>
                            {v.items.map((p) => (
                              <option key={p.id} value={p.id}>
                                An earlier proposal: {p.title}
                              </option>
                            ))}
                            <option value="blank">Nothing: I will build it from the call</option>
                          </select>
                        </label>
                      </>
                    }
                  />
                </div>
              </section>
            )}
            <ul className="mt-5 space-y-3">
              {v.items.map((p) => (
                <li key={p.id}>
                  <Link href={`/work/proposals?open=${p.id}`} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-forest">
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{p.title}</span>
                        <span className="mt-0.5 block text-sm text-muted">
                          {p.donor}
                          {p.deadline ? ` · ${sayMoment(p.deadline, zone)}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {p.readiness.scored.band && p.readiness.scored.rated === p.readiness.scored.of && <Pill tone={BAND_TONE[p.readiness.scored.band]}>{BAND_LABEL[p.readiness.scored.band]}</Pill>}
                        <Pill tone={p.outcome === "drafting" ? "ochre" : p.outcome === "won" ? "forest" : p.outcome === "submitted" ? "sky" : "muted"}>{OUTCOME_LABEL[p.outcome]}</Pill>
                      </span>
                    </span>
                    {p.outcome === "drafting" && <span className="mt-2 block text-sm">{p.readiness.next}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {!v.items.length && !adding && <p className="mt-6 rounded-2xl border border-line bg-surface p-6 text-sm text-muted">No proposals yet. {v.can.run ? "Start one from a matched opportunity, the standard list or an empty page." : "You will see a proposal here when you are added to one."}</p>}
          </>
        )}
      </main>
    </>
  );
}
