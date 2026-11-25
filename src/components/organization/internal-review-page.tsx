"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Why } from "@/components/app/why";
import { Loading, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import type { ReviewView } from "@/server/internal-review-store";
import { AREAS, AREA_KEYS, RATINGS, STEPS, previousQuarter, quarterOf, quarterRange, stepDue, type Area, type Finding, type Rating, type ReviewAction, type Roles, type SampleItem } from "@/lib/internal-review";
import { toCsv } from "@/lib/field-data";
import { plainError } from "@/lib/plain-error";

/** The quarterly internal review: roles, the sample, the cycle and the findings log (lib/internal-review). */

const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
// Ruled rows: numbered rows add their own 2.25rem column, so a numbered table's head starts with it.
const ROLES = "minmax(10rem,16rem) 1fr";
const STEP = "1fr auto";
const ITEM = "1fr auto";
const FINDING = "1fr";
const day = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const usd = (n: number) => (n ? `$${Math.round(n).toLocaleString("en-US")}` : "");
const qName = (q: string) => {
  const { months } = quarterRange(q);
  const m = (x: string) => new Date(`${x}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${m(months[0])} to ${m(months[2])} ${q.slice(0, 4)}`;
};
const ROLE_TITLE: Record<keyof Roles, string> = { lead: "Internal audit lead", reviewer: "Independent reviewer", focal: "Country office focal point", ceo: "CEO" };
const ROLE_HELP: Record<keyof Roles, string> = {
  lead: "Plans each review, draws the sample, tests it and tracks findings until closed.",
  reviewer: "Tests what the lead approved, reviews the draft and signs the final report.",
  focal: "Files the documents asked for within 5 working days and writes the management response.",
  ceo: "Receives each report and approves the corrective actions.",
};

export function InternalReviewPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<ReviewView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [quarter, setQuarter] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/org/internal-review", { cache: "no-store", headers: { "x-demo-user": user.id } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError((body as { error?: string }).error ?? plainError(res.status));
    else setV(body as ReviewView);
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  const act = async (a: ReviewAction, done: string) => {
    if (!user) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/org/internal-review", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      setV(body as ReviewView);
      setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const lastQuarter = v ? previousQuarter(quarterOf(v.today)) : "";
  const shown = quarter ?? v?.reviews[v.reviews.length - 1]?.quarter ?? null;
  const review = v?.reviews.find((r) => r.quarter === shown) ?? null;
  const name = (id: string) => v?.names[id] ?? id;
  const is = (r: keyof Roles | "admin") => !!v?.mine.includes(r);

  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHead back={{ href: "/organization", label: "Organization" }} title="Quarterly internal review" meta={v ? day(v.today) : undefined}>
          After each quarter the lead draws a sample from the app&apos;s records, the country office files the documents, the lead and an independent reviewer test each item, and findings are tracked until closed. Nobody tests something they prepared or approved.
        </PageHead>
        <Why>A donor asks whether the organization checks its own country offices. This review is that check, and its reports and findings log are what an auditor will ask to see.</Why>

        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v && !error && <Loading className="mt-6" />}

        {v && <RolesPanel v={v} busy={busy} onSave={(roles) => act({ action: "roles", roles }, "Saved who runs the review.")} />}

        {v?.roles && (
          <section>
            <SectionHead
              aside={
                <>
                  {v.reviews.length > 0 && (
                    <select aria-label="Quarter" className="min-h-12 border border-line bg-paper px-3 text-base" value={shown ?? ""} onChange={(e) => setQuarter(e.target.value)}>
                      {[...v.reviews].reverse().map((r) => (
                        <option key={r.quarter} value={r.quarter}>
                          {qName(r.quarter)}
                        </option>
                      ))}
                    </select>
                  )}
                  {is("lead") && !v.reviews.some((r) => r.quarter === lastQuarter) && (
                    <button type="button" className={primaryBtn} disabled={busy} onClick={() => void act({ action: "draw", quarter: lastQuarter }, `The sample for ${qName(lastQuarter)} is drawn. It stays as drawn.`).then((ok) => ok && setQuarter(lastQuarter))}>
                      Draw the sample for {qName(lastQuarter)}
                    </button>
                  )}
                </>
              }
            >
              The quarter
            </SectionHead>
            {!review && <Empty>No review yet. {is("lead") ? "Draw the first sample when you are ready." : `${name(v.roles.lead)}, the lead, draws the first sample.`}</Empty>}
            {review && <ReviewPanel v={v} review={review} busy={busy} act={act} />}
          </section>
        )}

        {v?.roles && <FindingsLog v={v} busy={busy} act={act} name={name} />}
      </main>
    </div>
  );
}

function RolesPanel({ v, busy, onSave }: { v: ReviewView; busy: boolean; onSave: (r: Roles) => Promise<boolean> }) {
  const [editing, setEditing] = useState(!v.roles);
  const [r, setR] = useState<Roles>(v.roles ?? { lead: "", reviewer: "", focal: "", ceo: "" });
  const admin = v.mine.includes("admin");
  const ok = r.lead && r.reviewer && r.focal && r.ceo && r.lead !== r.reviewer && r.focal !== r.lead && r.focal !== r.reviewer;
  return (
    <section>
      <SectionHead>Who runs it</SectionHead>
      {!editing && v.roles && (
        <LedgerTable cols={ROLES} head={["Role", "Person"]} label="Who runs it">
          {(Object.keys(ROLE_TITLE) as (keyof Roles)[]).map((k) => (
            <LedgerRow key={k} cols={ROLES} className="text-sm">
              <span className="text-muted">{ROLE_TITLE[k]}</span>
              <span className="font-semibold">{v.names[v.roles![k]] ?? v.roles![k]}</span>
            </LedgerRow>
          ))}
        </LedgerTable>
      )}
      {!editing && admin && (
        <button type="button" className={`${quietBtn} mt-3`} onClick={() => setEditing(true)}>
          Change who runs it
        </button>
      )}
      {editing && !admin && <p className="mt-2 text-sm text-muted">An administrator names the four people who run the review.</p>}
      {editing && admin && (
        <Sheet className="mt-3 grid gap-3 sm:grid-cols-2">
          {(Object.keys(ROLE_TITLE) as (keyof Roles)[]).map((k) => (
            <label key={k} className="text-sm">
              <span className="font-semibold">{ROLE_TITLE[k]}</span>
              <span className="block text-xs text-muted">{ROLE_HELP[k]}</span>
              <select className={input} value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })}>
                <option value="">Choose a person</option>
                {v.staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {r.lead && r.lead === r.reviewer && <p className="text-xs text-clay sm:col-span-2">The lead and the reviewer must be two people.</p>}
          {r.focal && (r.focal === r.lead || r.focal === r.reviewer) && <p className="text-xs text-clay sm:col-span-2">The focal point cannot also test the sample.</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={primaryBtn} disabled={busy || !ok} onClick={async () => (await onSave(r)) && setEditing(false)}>
              Save
            </button>
            {v.roles && (
              <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </Sheet>
      )}
    </section>
  );
}

type Act = (a: ReviewAction, done: string) => Promise<boolean>;
type Review = ReviewView["reviews"][number];

function ReviewPanel({ v, review, busy, act }: { v: ReviewView; review: Review; busy: boolean; act: Act }) {
  const roles = v.roles!;
  const name = (id: string) => v.names[id] ?? id;
  const tested = review.items.filter((i) => i.result).length;
  const next = STEPS.find((s) => !review.steps[s.id]);
  const byArea = useMemo(() => AREA_KEYS.map((a) => ({ a, items: review.items.filter((i) => i.area === a) })).filter((g) => g.items.length), [review.items]);

  const download = () => {
    const rows = review.items.map((i) => [AREAS[i.area].title, i.what, i.date, i.usd ? String(Math.round(i.usd)) : "", i.why, i.tester === "lead" ? name(roles.lead) : i.tester === "reviewer" ? name(roles.reviewer) : "Someone else", i.result ? (i.result.ok ? "No problem found" : "Problem") : "Not tested", i.result?.note ?? "", i.result ? name(i.result.by) : ""]);
    const csv = toCsv({ headers: ["Area", "Item", "Date", "USD", "Why in the sample", "Tested by", "Result", "Note", "Recorded by"], rows });
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `internal-review-${review.quarter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <LedgerTable cols={`2.25rem ${STEP}`} head={["#", "Step", ""]} label="Steps of the review">
        {STEPS.map((s, i) => {
          const done = review.steps[s.id];
          const due = stepDue(review.quarter, s.day);
          const late = !done && due < v.today;
          const who = roles[s.by as keyof Roles];
          const mine = next?.id === s.id && v.mine.includes(s.by as keyof Roles);
          return (
            <LedgerRow key={s.id} cols={STEP} n={i + 1} first={next?.id === s.id} className="text-sm">
              <span className="min-w-0">
                <span className={done ? "text-muted line-through" : "font-medium"}>{s.title}</span>
                <span className="block text-xs text-muted">
                  {done ? `Done by ${name(done.by)} on ${day(done.at)}` : `${name(who)} · by ${day(due)}`}
                  {late && <span className="font-semibold text-clay"> · late</span>}
                </span>
              </span>
              {mine && (
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => void act({ action: "step", quarter: review.quarter, step: s.id }, "Recorded.")}>
                  Mark done
                </button>
              )}
            </LedgerRow>
          );
        })}
      </LedgerTable>
      {next && <p className="mt-2 text-xs text-muted">The shaded step is the next one to do.</p>}

      <div>
        <SectionHead
          aside={
            <button type="button" className={quietBtn} onClick={download}>
              Download the sample and results
            </button>
          }
        >
          The sample
        </SectionHead>
        <p className="mt-1 text-sm text-muted">
          Drawn by {name(review.drawnBy)} on <Fig className="text-sm">{day(review.drawnAt)}</Fig> from the records of {qName(review.quarter)}.{" "}
          <Fig className="text-sm">
            {tested} of {review.items.length}
          </Fig>{" "}
          tested.
        </p>
        {byArea.map(({ a, items }) => (
          <div key={a} className="mt-6">
            <p className="font-ledger font-bold">{AREAS[a].title}</p>
            <p className="text-xs text-muted">
              Checks: {AREAS[a].checks}. Sample: {AREAS[a].sample}.
            </p>
            <LedgerTable cols={`2.25rem ${ITEM}`} head={["#", "Item", ""]} label={AREAS[a].title} className="mt-2">
              {items.map((i, n) => (
                <ItemRow key={i.ref} n={n + 1} i={i} v={v} quarter={review.quarter} busy={busy || !!review.steps.finalSigned} act={act} />
              ))}
            </LedgerTable>
          </div>
        ))}
        {!byArea.some((g) => g.a !== "assets") && <p className="mt-3 text-sm text-muted">The app had no records for this quarter beyond the asset spot check.</p>}
      </div>
    </div>
  );
}

function ItemRow({ n, i, v, quarter, busy, act }: { n: number; i: SampleItem; v: ReviewView; quarter: string; busy: boolean; act: Act }) {
  const roles = v.roles!;
  const [open, setOpen] = useState<null | "ok" | "problem">(null);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState<Rating>("medium");
  const name = (id: string) => v.names[id] ?? id;
  const touched = [...i.preparedBy, ...i.approvedBy].includes(v.me);
  const mayTest = !touched && (i.tester === "lead" ? v.mine.includes("lead") : i.tester === "reviewer" ? v.mine.includes("reviewer") : v.mine.includes("admin") && v.me !== roles.focal);
  const tester = i.tester === "lead" ? name(roles.lead) : i.tester === "reviewer" ? name(roles.reviewer) : "Someone who did not prepare or approve it";
  const figs = [day(i.date), usd(i.usd)].filter(Boolean).join(" · ");
  return (
    <LedgerRow cols={ITEM} n={n} className="text-sm">
        <span className="min-w-0">
          {i.href ? (
            <Link href={i.href} className="font-medium text-forest hover:underline">
              {i.what}
            </Link>
          ) : (
            <span className="font-medium">{i.what}</span>
          )}
          <span className="block text-xs text-muted">
            {figs && <span className="font-mono tabular-nums">{figs}</span>}
            {figs && " · "}
            {[i.why, `tested by ${tester}`].filter(Boolean).join(" · ")}
          </span>
          {i.result && (
            <span className={`block text-xs ${i.result.ok ? "text-leaf" : "font-semibold text-clay"}`}>
              {i.result.ok ? "No problem found" : "Problem"}
              {i.result.note ? `: ${i.result.note}` : ""} · {name(i.result.by)}, {day(i.result.at)}
            </span>
          )}
        </span>
        {mayTest && !i.result && !open && (
          <span className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={quietBtn} disabled={busy} onClick={() => setOpen("ok")}>
              No problem
            </button>
            <button type="button" className={quietBtn} disabled={busy} onClick={() => setOpen("problem")}>
              Problem
            </button>
          </span>
        )}
      {open && (
        <div className="col-span-full mt-2 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto]">
          <label className="text-xs">
            {open === "ok" ? "Note (optional)" : "What is wrong"}
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {open === "problem" && (
            <label className="text-xs">
              How serious
              <select className={input} value={rating} onChange={(e) => setRating(e.target.value as Rating)}>
                {(Object.keys(RATINGS) as Rating[]).map((r) => (
                  <option key={r} value={r}>
                    {RATINGS[r].title}: {RATINGS[r].rule.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || (open === "problem" && note.trim().length < 10)}
              onClick={async () => {
                const ok = await act({ action: "test", quarter, ref: i.ref, ok: open === "ok", note: note.trim() }, open === "ok" ? "Recorded: no problem found." : "Recorded, and added to the findings log.");
                if (ok && open === "problem") await act({ action: "finding", quarter, area: i.area, ref: i.ref, rating, text: `${i.what}: ${note.trim()}` }, "Recorded, and added to the findings log.");
                if (ok) setOpen(null);
              }}
            >
              Record
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </LedgerRow>
  );
}

function FindingsLog({ v, busy, act, name }: { v: ReviewView; busy: boolean; act: Act; name: (id: string) => string }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<{ area: Area; rating: Rating; text: string }>({ area: "payments", rating: "medium", text: "" });
  const open = v.findings.filter((x) => !x.closed).sort((a, b) => a.due.localeCompare(b.due));
  const closed = v.findings.filter((x) => x.closed);
  const quarter = v.reviews[v.reviews.length - 1]?.quarter;
  return (
    <section className="mt-10">
      <SectionHead
        className=""
        aside={
          quarter &&
          (v.mine.includes("lead") || v.mine.includes("reviewer")) &&
          !adding && (
            <button type="button" className={quietBtn} onClick={() => setAdding(true)}>
              Record a finding
            </button>
          )
        }
      >
        Findings log
      </SectionHead>
      <p className="mt-1 text-sm text-muted">
        High: {RATINGS.high.rule.toLowerCase()}. Medium: {RATINGS.medium.rule.toLowerCase()}. Low: {RATINGS.low.rule.toLowerCase()}. A finding closes once the CEO has approved the corrective action and the lead re-tests the fix.
      </p>
      {adding && quarter && (
        <Sheet className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Area
            <select className={input} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as Area })}>
              {AREA_KEYS.map((a) => (
                <option key={a} value={a}>
                  {AREAS[a].title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            How serious
            <select className={input} value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value as Rating })}>
              {(Object.keys(RATINGS) as Rating[]).map((r) => (
                <option key={r} value={r}>
                  {RATINGS[r].title}: {RATINGS[r].meaning.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            What was found
            <textarea rows={3} className={input} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          </label>
          <span className="flex gap-2 sm:col-span-2">
            <button type="button" className={primaryBtn} disabled={busy || f.text.trim().length < 10} onClick={async () => (await act({ action: "finding", quarter, ...f, text: f.text.trim() }, "Added to the findings log.")) && (setAdding(false), setF({ ...f, text: "" }))}>
              Add to the log
            </button>
            <button type="button" className={quietBtn} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </span>
        </Sheet>
      )}
      {v.findings.length === 0 ? (
        <Empty>No findings recorded.</Empty>
      ) : (
        <>
          <LedgerTable cols={`2.25rem ${FINDING}`} head={["#", "Finding"]} label="Findings log">
            {[...open, ...closed].map((x, n) => (
              <FindingRow key={x.id} n={n + 1} x={x} v={v} busy={busy} act={act} name={name} first={n === 0 && !x.closed} />
            ))}
          </LedgerTable>
          {open.length > 0 && <p className="mt-2 text-xs text-muted">The shaded finding is the open one due soonest.</p>}
        </>
      )}
    </section>
  );
}

function FindingRow({ n, x, v, busy, act, name, first }: { n: number; x: Finding; v: ReviewView; busy: boolean; act: Act; name: (id: string) => string; first: boolean }) {
  const [mode, setMode] = useState<null | "respond" | "close">(null);
  const [text, setText] = useState("");
  const late = !x.closed && x.due < v.today;
  return (
    <LedgerRow cols={FINDING} n={n} first={first} className={`text-sm ${x.closed ? "opacity-70" : ""}`}>
        <div className="min-w-0">
          <p>
            <StatusBlock tone={x.rating === "high" ? "clay" : x.rating === "medium" ? "ochre" : "muted"}>{RATINGS[x.rating].title}</StatusBlock> · {AREAS[x.area].title} · {qName(x.quarter)}
          </p>
          <p className="mt-0.5">{x.text}</p>
          <p className="text-xs text-muted">
            Found by {name(x.by)} on {day(x.at)} · {x.closed ? `closed by ${name(x.closed.by)} on ${day(x.closed.at)}: ${x.closed.note}` : <span className={late ? "font-semibold text-clay" : ""}>due {day(x.due)}{late ? ", late" : ""}</span>}
          </p>
          {x.response && (
            <p className="mt-1 text-xs">
              <span className="font-semibold">Response ({name(x.response.by)}, {day(x.response.at)}): </span>
              {x.response.text}
            </p>
          )}
          {x.approved && <p className="text-xs text-leaf">Corrective action approved by {name(x.approved.by)} on {day(x.approved.at)}</p>}
          {!x.closed && (
            <div className="mt-2 flex flex-wrap gap-2">
              {v.mine.includes("focal") && !mode && (
                <button type="button" className={quietBtn} onClick={() => setMode("respond")}>
                  {x.response ? "Change the response" : "Write the response"}
                </button>
              )}
              {v.mine.includes("ceo") && x.response && !x.approved && (
                <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "approve", finding: x.id }, "Corrective action approved.")}>
                  Approve the corrective action
                </button>
              )}
              {v.mine.includes("lead") && x.response && x.approved && !mode && (
                <button type="button" className={quietBtn} onClick={() => setMode("close")}>
                  Close after re-testing
                </button>
              )}
            </div>
          )}
          {mode && (
            <div className="mt-2 space-y-2">
              <label className="block text-xs">
                {mode === "respond" ? "What the office will do, and by when" : "How the re-test showed it is fixed"}
                <textarea rows={2} className={input} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy || text.trim().length < 10}
                  onClick={async () => {
                    const ok = mode === "respond" ? await act({ action: "respond", finding: x.id, text: text.trim() }, "Response recorded.") : await act({ action: "close", finding: x.id, note: text.trim() }, "Finding closed.");
                    if (ok) setMode(null);
                  }}
                >
                  Save
                </button>
                <button type="button" className={quietBtn} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </span>
            </div>
          )}
        </div>
    </LedgerRow>
  );
}
