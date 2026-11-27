"use client";

import { AnyLinkCaution } from "@/components/app/any-link-caution";
import { longDate } from "@/lib/weekly";
import { storeNames } from "@/lib/file-store";
import { Why } from "@/components/app/why";
import { unitOf } from "@/lib/package";
import { plainError } from "@/lib/plain-error";
import { askConfirm } from "@/components/app/dialogs";
import Link from "next/link";
import { SelfConfirmSheet } from "@/components/app/self-confirm";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { OriginalText } from "@/components/progress/original-text";
import { TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import type { Receipt } from "@/lib/expense";
import { readWorkbook } from "@/lib/read-sheet";
import { TEMPLATE_CSV, parseCsv, readResults, type ImportRow } from "@/lib/results-import";
import { YOUTH, placesFor, proofCount, proofLinkSchema, quarterOf, quarterRange, type ProofLink, type ResultAction, type ResultInput, type UpdateInput } from "@/lib/results";
import type { ResultsView } from "@/app/api/projects/[code]/results/route";
import { measured } from "@/lib/measure";
import { NamesWarning } from "@/components/progress/names-warning";
import { LookedAt } from "@/components/app/ai-why";
import { FieldHelp } from "@/components/app/field-help";
import { ErrorNote } from "@/components/app/error-note";
import { FieldRecords, useFieldForms, type FieldForms } from "@/components/progress/field-records";

/**
 * Results recorded with their proof. Field staff record what was achieved (10 ha of drip
 * irrigation in Helmand, 45 women trained in Kandahar) with the attendance sheet, photos or
 * verification report attached; MEL accepts or queries it; only accepted results count in
 * Progress and the donor report. `?indicator=IND-3&q=2026-Q3` opens the records behind one figure.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const STATUS = { pending: { tone: "ochre", text: "Waiting for MEL" }, accepted: { tone: "forest", text: "Accepted" }, queried: { tone: "clay", text: "Sent back with a question" } } as const;

type Ind = ResultsView["indicators"][number];
type Res = ResultsView["results"][number];

export function ResultsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const { t, tx } = useT();
  const params = useSearchParams();
  const [v, setV] = useState<ResultsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [addingUpdate, setAddingUpdate] = useState(false);
  // The flagged results being reviewed one at a time (ids fixed when the review starts), or null.
  const [reviewing, setReviewing] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string | null>(params.get("indicator"));
  const quarter = params.get("q");

  // From "+ New → Record a result": once loaded, put the person on the indicator picker.
  const recordAsked = params.get("record") === "1";
  // A result filled in from another record (a closed-out grant, a distribution list: lib/connections.ts), for the person to check and send.
  const [prefill] = useState<Prefill | null>(() => {
    if (!recordAsked || !params.get("from")) return null;
    const keep = Object.fromEntries((["date", "value", "female", "male", "womenLed", "menLed", "province", "note"] as const).map((k) => [k, params.get(k) ?? ""]).filter(([, x]) => x));
    return { from: params.get("from")!, fields: keep };
  });
  const updateFor = params.get("update");
  useEffect(() => {
    if (!v) return;
    const ind = params.get("indicator");
    if (recordAsked && ind && v.indicators.some((i) => i.code === ind && !i.fromKobo)) setAdding(ind);
    if (updateFor && v.activities.some((a) => a.code === updateFor)) {
      setAddingUpdate(true);
      document.getElementById("activity-updates")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only when the page first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!v]);
  useEffect(() => {
    if (!recordAsked || !v) return;
    const el = document.getElementById("record-pick");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }, [recordAsked, v]);
  const url = `/api/projects/${project.id}/results`;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<ResultsView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  useEffect(() => {
    if (open && v) document.getElementById(`ind-${open}`)?.scrollIntoView({ block: "start" });
  }, [open, v]);

  // KoboCollect field forms: the second part of "To check" (field-records).
  const fieldForms = useFieldForms(project.id, project.saved);
  const groups = useMemo(() => {
    const m = new Map<string, Ind[]>();
    for (const i of v?.indicators ?? []) m.set(i.result ?? "", [...(m.get(i.result ?? "") ?? []), i]);
    return [...m.entries()];
  }, [v]);

  if (!user) return null;
  const act = async (a: ResultAction, msg: string) => {
    setError("");
    try {
      setV(await call<ResultsView>(url, user.id, { method: "POST", body: JSON.stringify(a) }));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  // Solo mode adds MEL's own results, accepted one at a time with the statement (server/solo.ts).
  const waiting = v?.results.filter((r) => r.canReview || r.canSelfAccept) ?? [];
  // This person's own results that MEL sent back with a question.
  const sentBack = v?.results.filter((r) => r.status === "queried" && r.by === v.me) ?? [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const [pf, pt] = [params.get("from") ?? "", params.get("to") ?? ""];
  const range = quarter && /^\d{4}-Q[1-4]$/.test(quarter) ? quarterRange(quarter) : iso.test(pf) && iso.test(pt) ? { from: pf, to: pt } : null;
  const rangeLabel = quarter ?? (range ? `${longDate(range.from)} to ${longDate(range.to)}` : "");

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHead back={{ href: "/progress", label: "Progress and report" }} kicker={project.name} title="Results and their proof">
          Record each result with the attendance sheet, photos or verification report that proves it. MEL (the monitoring, evaluation and learning team) checks it; once accepted it counts in Progress and in the donor report, and every figure there
          opens these records.
        </PageHead>
        <Why>A donor pays for results it can check. A figure with no attendance sheet, photo or report behind it is the first thing an auditor questions, and a questioned figure can mean money paid back.</Why>
        {!project.saved && <Empty className="mt-6">Choose a project saved in the database (for example ACRP).</Empty>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {project.saved && !v && !error && <p className="mt-10 text-center text-sm text-muted">{t("load.wait")}</p>}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && !v.indicators.length && <Empty className="mt-6">{t("pw.noTargets")}</Empty>}

        {v && reviewing && <ReviewQueue ids={reviewing} v={v} act={act} onClose={() => setReviewing(null)} />}

        {/* Results MEL sent back to this person: said first, with one button to each target that holds one. */}
        {v && !range && !reviewing && sentBack.length > 0 && (
          <div className="mt-6 bg-clay-soft px-4 py-3 text-sm text-clay">
            <p className="font-semibold">
              {sentBack.length === 1 ? tx("MEL sent 1 of your results back with a question. It does not count until you answer.") : `MEL sent ${sentBack.length} of your results back with a question. They do not count until you answer.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {v.indicators
                .filter((i) => sentBack.some((r) => r.indicator === i.code))
                .map((i) => (
                  <button
                    key={i.code}
                    type="button"
                    className={quietBtn}
                    onClick={() => {
                      setOpen(i.code);
                      setTimeout(() => document.querySelector(`#ind-${i.code} [data-sent-back]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
                    }}
                  >
                    Open {i.donorCode ?? i.code} {i.name}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* One place for everything waiting to be checked: typed-in results, then KoboCollect field forms. */}
        {project.saved && !range && !reviewing && (fieldForms.show || waiting.length > 0) && (
          <ToCheck
            v={v}
            waiting={waiting}
            f={fieldForms}
            act={act}
            onReview={(ids) => {
              setReviewing(ids);
              window.scrollTo({ top: 0 });
            }}
          />
        )}

        {v && v.indicators.length > 0 && !range && !reviewing && (
          <WhatNeedsDoing
            v={v}
            me={v.me}
            onRecord={(code) => {
              setOpen(code);
              setAdding(code);
              setTimeout(() => document.getElementById(`ind-${code}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
          />
        )}

        {range && (
          <p className="mt-6 flex flex-wrap items-center gap-x-3 bg-sunken px-4 py-1 text-sm">
            <span>
              Showing <span className="font-mono">{quarter ? `${quarter} (${longDate(range.from)} to ${longDate(range.to)})` : rangeLabel}</span> only.
            </span>
            <Link href={`/progress/results${open ? `?indicator=${open}` : ""}`} className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
              Show all
            </Link>
          </p>
        )}

        {/* With a period chosen, "To check" is not shown above: the results waiting in it are listed here, as before. */}
        {v && range && waiting.length > 0 && !reviewing && (
          <section className="mt-6">
            <SectionHead className="" aside={<Fig strong>{waiting.length}</Fig>}>
              To check
            </SectionHead>
            <ResultRows list={waiting} v={v} act={act} label="To check" oldestFirst />
          </section>
        )}

        {v &&
          groups.map(([output, list]) => (
            <section key={output} className="mt-8">
              <SectionHead className="">{output || t("pw.targets")}</SectionHead>
              <ul className="mt-3 border-t border-ink font-ledger [&>li:last-child]:border-ink">
                {list.map((i) => {
                  const mine = v.results.filter((r) => r.indicator === i.code && (!range || (r.date >= range.from && r.date <= range.to)));
                  // The same figure as Progress and the report (lib/measure): a sum, or a survey's figure.
                  const all = measured(i, v.results.filter((r) => r.indicator === i.code), i.measure);
                  const shown = measured(i, mine, i.measure);
                  const pending = mine.filter((r) => r.status === "pending").length;
                  const isOpen = open === i.code;
                  return (
                    <li key={i.code} id={`ind-${i.code}`} className={`scroll-mt-20 border-b ${isOpen ? "border-ink" : "border-line"}`}>
                      <button
                        type="button"
                        className={`flex min-h-12 w-full items-start gap-3 px-3 pt-2.5 text-start hover:bg-ochre-soft focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest`}
                        onClick={() => setOpen(isOpen ? null : i.code)}
                        aria-expanded={isOpen}
                      >
                        <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-muted">{i.donorCode ?? i.code}</span>
                        <span className="min-w-0 flex-1 font-semibold leading-snug">{i.name}</span>
                        <span className="shrink-0 text-end">
                          {(range ? shown : all).note ? (
                            <span className="font-mono text-sm font-bold text-clay">{(range ? shown : all).note}</span>
                          ) : (
                            <span className="font-mono text-xl font-bold tabular-nums">{num(range ? shown.value : all.value)}</span>
                          )}
                          <span className="block text-xs text-muted">{range ? `${quarter ? "in" : "from"} ${rangeLabel}` : `of ${num(i.target)} ${i.unit}`}</span>
                        </span>
                      </button>
                      <p className="flex flex-wrap gap-x-3 px-3 pb-2.5 ps-[5.5rem] text-xs text-muted">
                        <span>
                          <span className="font-mono">{shown.records}</span> accepted record{shown.records === 1 ? "" : "s"} · <span className="font-mono">{shown.files}</span> file{shown.files === 1 ? "" : "s"}
                        </span>
                        {shown.female + shown.male > 0 && (
                          <span>
                            <span className="font-mono">{num(shown.female)}</span> women · <span className="font-mono">{num(shown.male)}</span> men
                          </span>
                        )}
                        {pending > 0 && (
                          <span className="text-warn">
                            <span className="font-mono">{pending}</span> waiting for MEL
                          </span>
                        )}
                        {i.verification && <span>Proof: {i.verification}</span>}
                      </p>
                      {isOpen && (
                        <div className="space-y-3 px-3 pb-4">
                          {i.fromKobo ? (
                            <p className="text-sm text-muted">{t("pw.fromKobo")}</p>
                          ) : adding === i.code ? (
                            <RecordForm ind={i} prefill={prefill} onClose={() => setAdding(null)} add={(r) => act({ action: "record", result: r }, "Recorded. MEL will check it.").then(() => setAdding(null))} />
                          ) : (
                            v.mayRecord && (
                              <button type="button" className={quietBtn} onClick={() => setAdding(i.code)}>
                                Record a result
                              </button>
                            )
                          )}
                          {!mine.length && <Empty className="mt-3">Nothing recorded{range ? ` ${quarter ? "in" : "from"} ${rangeLabel}` : ""} yet.</Empty>}
                          {mine.length > 0 && <ResultRows list={mine} v={v} ind={i} act={act} label={`${i.donorCode ?? i.code}: ${i.name}`} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

        {v?.mayRecord && v.indicators.some((i) => !i.fromKobo) && <ImportResults indicators={v.indicators.filter((i) => !i.fromKobo)} act={act} />}
        {v && v.activities.length > 0 && (
          <section id="activity-updates" className="mt-10 scroll-mt-24">
            <SectionHead className="">Activity updates</SectionHead>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Progress that is not a count on an indicator: reservoirs built, grant agreements signed, sales at an exhibition, an analysis finished. Add photos with a caption to put them in the donor
              report. Updates go into the report&rsquo;s narrative; they never change a figure.
            </p>
            {v.mayUpdate && !addingUpdate && (
              <button type="button" className={`${quietBtn} mt-3`} onClick={() => setAddingUpdate(true)}>
                Add an update
              </button>
            )}
            {addingUpdate && (
              <UpdateForm activities={v.activities} start={updateFor} onClose={() => setAddingUpdate(false)} add={(u) => act({ action: "update", update: u }, "Update added.").then(() => setAddingUpdate(false))} />
            )}
            {v.activities.map((a) => {
              const list = v.updates.filter((u) => u.activity === a.code && (!range || (u.date >= range.from && u.date <= range.to)));
              if (!list.length) return null;
              return (
                <div key={a.code} className="mt-6">
                  <h3 className="font-ledger text-base font-bold leading-tight text-ink">
                    Activity <span className="font-mono">{a.code}</span>: {a.name}
                  </h3>
                  <div className="mt-2 border-t border-ink font-ledger [&>article:last-child]:border-ink">
                    {list.map((u) => (
                      <article key={u.id} className="border-b border-line px-3 py-3 text-sm">
                        <p className="text-xs text-muted">
                          <span className="font-mono">{u.date}</span> · <span className="font-mono">{u.quarter}</span> · by {u.by}
                        </p>
                        <p className="mt-1 whitespace-pre-line">{u.note}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {u.files.map((f) => (
                            <button
                              key={f.hash}
                              type="button"
                              onClick={() => void openReceipt(f.hash, user.id)}
                              className="min-h-11 border border-line px-2 py-1 text-start text-xs font-semibold text-forest hover:bg-ochre-soft"
                            >
                              {f.name}
                              {u.captions?.[f.hash] && <span className="block font-normal text-muted">Photo in the report: {u.captions[f.hash]}</span>}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}

/** Only captions for photos still attached, and not empty. */
const cleanCaptions = (c: Record<string, string>, files: Receipt[]) => {
  const out = Object.fromEntries(
    Object.entries(c)
      .filter(([h, v]) => v.trim() && files.some((f) => f.hash === h && f.type.startsWith("image/")))
      .map(([h, v]) => [h, v.trim()]),
  );
  return Object.keys(out).length ? out : undefined;
};

/** Upload photos and documents; each photo can get a caption, and captioned photos go into the donor report. */
function ProofPicker({
  files,
  setFiles,
  captions,
  setCaptions,
  setErr,
  setBusy,
}: {
  files: Receipt[];
  setFiles: (f: Receipt[] | ((c: Receipt[]) => Receipt[])) => void;
  captions: Record<string, string>;
  setCaptions: (c: Record<string, string>) => void;
  setErr: (s: string) => void;
  setBusy: (b: boolean) => void;
}) {
  const { user } = useSession();
  const upload = async (list: FileList | null) => {
    if (!list) return;
    setErr("");
    setBusy(true);
    try {
      const added: Receipt[] = [];
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.append("file", await shrink(file));
        added.push(await call<Receipt>("/api/files", user?.id, { method: "POST", body }));
      }
      setFiles((cur) => [...cur, ...added].slice(0, 20));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1 block min-h-11 text-sm" onChange={(e) => void upload(e.target.files)} />
      {files.length > 0 && (
        <ul className="mt-2 border-t border-line">
          {files.map((x) => (
            <li key={x.hash} className="border-b border-line py-2 text-xs">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words">{x.name}</span>
                <button type="button" aria-label={`Remove ${x.name}`} className="min-h-11 min-w-11 text-base text-muted hover:text-clay" onClick={() => setFiles(files.filter((y) => y.hash !== x.hash))}>
                  ×
                </button>
              </span>
              {x.type.startsWith("image/") && (
                <input
                  className={input}
                  placeholder="Caption, to put this photo in the report: what, where, when"
                  value={captions[x.hash] ?? ""}
                  onChange={(e) => setCaptions({ ...captions, [x.hash]: e.target.value })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UpdateForm({ activities, start, add, onClose }: { activities: { code: string; name: string }[]; start?: string | null; add: (u: UpdateInput) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ activity: (start && activities.some((a) => a.code === start) ? start : activities[0]?.code) ?? "", date: new Date().toISOString().slice(0, 10), note: "" });
  const [files, setFiles] = useState<Receipt[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    if (f.note.trim().length < 10) return setErr("Say what happened: it goes into the report.");
    setBusy(true);
    try {
      await add({ activity: f.activity, date: f.date, note: f.note.trim(), files, captions: cleanCaptions(captions, files) });
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className="mt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-2">
          Activity
          <select className={input} value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })}>
            {activities.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code}: {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Date
          <input type="date" className={input} value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
      </div>
      <label className="mt-3 block text-sm">
        What happened
        <textarea
          className={input}
          rows={4}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="10 of the 15 planned water reservoirs completed in Nesh, Maiwand, Musa Qala and Sangin (about 121 m³ each)."
        />
        <NamesWarning text={f.note} />
      </label>
      <div className="mt-3 text-sm">
        Photos or documents (optional)
        <ProofPicker files={files} setFiles={setFiles} captions={captions} setCaptions={setCaptions} setErr={setErr} setBusy={setBusy} />
      </div>
      {err && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {err}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => void submit()}>
          Add update
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Link documents already in SharePoint (Copy link) instead of uploading them again. */
function LinkPicker({ links, setLinks }: { links: ProofLink[]; setLinks: (l: ProofLink[]) => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const add = () => {
    const r = proofLinkSchema.safeParse({ title, url });
    if (!r.success) return setErr(r.error.issues[0]?.message ?? "Check the link.");
    if (!links.some((l) => l.url === r.data.url)) setLinks([...links, r.data].slice(0, 20));
    setTitle("");
    setUrl("");
    setErr("");
  };
  return (
    <div className="mt-2">
      <span className="block text-xs text-muted">Or link a document in {storeNames()} (open it, then Copy link)</span>
      <AnyLinkCaution />
      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What it is: attendance sheet, 27–30 Jul" aria-label="Document title" />
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Document link" inputMode="url" />
        <button type="button" className={`${quietBtn} mt-1 min-h-11`} onClick={add}>
          Add link
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-clay">{err}</p>}
      {links.length > 0 && (
        <ul className="mt-2 border-t border-line">
          {links.map((l) => (
            <li key={l.url} className="flex items-center gap-2 border-b border-line py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {l.title} <span className="text-muted">· {l.url}</span>
              </span>
              <button type="button" aria-label={`Remove ${l.title}`} className="min-h-11 min-w-11 text-base text-muted hover:text-clay" onClick={() => setLinks(links.filter((x) => x.url !== l.url))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Adds proof to a result already recorded; the figure and its review stay as they are. */
function AddProof({ r, act, onClose }: { r: Res; act: (a: ResultAction, msg: string) => Promise<void>; onClose: () => void }) {
  const [files, setFiles] = useState<Receipt[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<ProofLink[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await act({ action: "proof", id: r.id, files, links, captions: cleanCaptions(captions, files) }, "Proof added.");
      onClose();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className="mt-3 text-sm">
      <span className="font-ledger font-bold">Add proof</span>
      <ProofPicker files={files} setFiles={setFiles} captions={captions} setCaptions={setCaptions} setErr={setErr} setBusy={setBusy} />
      <LinkPicker links={links} setLinks={setLinks} />
      {err && <p className="mt-2 text-xs text-clay">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || files.length + links.length === 0} className={primaryBtn} onClick={() => void save()}>
          Save proof
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** The recorder answers MEL's query: corrected figures and a note on what changed. */
function CorrectForm({ r, act, onClose }: { r: Res; act: (a: ResultAction, msg: string) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({
    date: r.date,
    value: String(r.value),
    female: r.female?.toString() ?? "",
    male: r.male?.toString() ?? "",
    womenLed: r.womenLed?.toString() ?? "",
    menLed: r.menLed?.toString() ?? "",
    province: r.province ?? "",
    district: r.district ?? "",
    note: r.note,
  });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const opt = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const save = async () => {
    setBusy(true);
    try {
      await act(
        {
          action: "correct",
          id: r.id,
          reply: reply.trim(),
          changes: {
            date: f.date,
            value: Number(f.value),
            female: opt(f.female),
            male: opt(f.male),
            womenLed: opt(f.womenLed),
            menLed: opt(f.menLed),
            province: f.province || undefined,
            district: f.district.trim() || undefined,
            note: f.note.trim(),
          },
        },
        "Corrected and sent back to MEL.",
      );
      onClose();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  const box = "mt-1 min-h-11 w-full border border-line bg-paper px-2 py-1.5 text-sm";
  return (
    <Sheet className="mt-3 text-sm">
      <span className="font-ledger font-bold">Correct and resubmit</span>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-muted">
          Date
          <input type="date" className={box} value={f.date} onChange={set("date")} />
        </label>
        <label className="text-xs text-muted">
          Value
          <input type="number" min={0} step="any" className={box} value={f.value} onChange={set("value")} />
        </label>
        {r.female !== undefined || r.male !== undefined ? (
          <>
            <label className="text-xs text-muted">
              Women
              <input type="number" min={0} className={box} value={f.female} onChange={set("female")} />
            </label>
            <label className="text-xs text-muted">
              Men
              <input type="number" min={0} className={box} value={f.male} onChange={set("male")} />
            </label>
          </>
        ) : null}
        {r.womenLed !== undefined || r.menLed !== undefined ? (
          <>
            <label className="text-xs text-muted">
              Women-led
              <input type="number" min={0} className={box} value={f.womenLed} onChange={set("womenLed")} />
            </label>
            <label className="text-xs text-muted">
              Men-led
              <input type="number" min={0} className={box} value={f.menLed} onChange={set("menLed")} />
            </label>
          </>
        ) : null}
        <PlaceField className="text-xs text-muted" control={box} value={f.province} onChange={set("province")} />
        <label className="text-xs text-muted">
          District
          <input className={box} value={f.district} onChange={set("district")} />
        </label>
      </div>
      <label className="mt-2 block text-xs text-muted">
        What was done
        <textarea className={box} rows={2} value={f.note} onChange={set("note")} />
      </label>
      <label className="mt-2 block text-xs text-muted">
        Your answer to MEL: what you changed and why
        <input className={box} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Corrected to 274 men and 50 women; the attendance sheet counted staff twice." />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={busy || reply.trim().length < 5} onClick={() => void save()}>
          Send back to MEL
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Where a result happened, one level below the country: a list for the project's own country
 * (provinces in Afghanistan, departments in Guatemala), typed in for a country with no list.
 */
function PlaceField({ className, control, value, onChange, help }: { className: string; control: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; help?: boolean }) {
  const { project } = useCurrentProject();
  const places = placesFor(project.country);
  return (
    <label className={className}>
      {places?.label ?? "Province or region"}
      {help && <FieldHelp field="result.place" />}
      {places ? (
        <select className={control} value={value} onChange={onChange}>
          <option value="">—</option>
          {/* A place recorded before the list changed stays choosable. */}
          {value && !places.names.includes(value) && <option>{value}</option>}
          {places.names.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      ) : (
        <input className={control} value={value} onChange={onChange} maxLength={60} />
      )}
    </label>
  );
}

function ResultCard({ r, ind, act, mayAddProof, me, first }: { r: Res; ind?: Ind; act: (a: ResultAction, msg: string) => Promise<void>; mayAddProof: boolean; me: string; first?: boolean }) {
  const { project } = useCurrentProject();
  const { t, tx } = useT();
  const [selfing, setSelfing] = useState(false);
  const { user } = useSession();
  const [query, setQuery] = useState<string | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  const place = [r.district, r.province].filter(Boolean).join(", ");
  // The latest question and answer, when the result has been corrected.
  const lastAnswer = (r.history ?? []).at(-1);
  return (
    <LedgerRow cols="minmax(0,1fr)" first={first}>
      <article className="min-w-0" {...(r.status === "queried" ? { "data-sent-back": "" } : {})}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StatusBlock tone={STATUS[r.status].tone}>{STATUS[r.status].text}</StatusBlock>
          <span>
            <Fig strong>{num(r.value)}</Fig> {ind?.unit ? unitOf(r.value, ind.unit) : ""}
          </span>
          <span className="text-muted">
            <span className="font-mono">{r.date}</span> · <span className="font-mono">{quarterOf(r.date)}</span>
            {place && ` · ${place}`}
            {r.crop && ` · ${r.crop}`}
          </span>
        </div>
        {ind && !r.canReview
          ? null
          : ind && (
              <p className="mt-1 text-xs text-muted">
                <span className="font-mono">{ind.donorCode ?? ind.code}</span>: {ind.name}
              </p>
            )}
        <p className="mt-2 whitespace-pre-line text-sm">{r.note}</p>
        <OriginalText original={r.original} />
        {(r.female !== undefined || r.male !== undefined || r.womenLed !== undefined || r.menLed !== undefined) && (
          <p className="mt-1 text-xs text-muted">
            {r.female !== undefined && `${r.female} ${r.female === 1 ? "woman" : "women"}`}
            {r.male !== undefined && ` · ${r.male} ${r.male === 1 ? "man" : "men"}`}
            {r.womenLed !== undefined && ` · ${r.womenLed} women-led`}
            {r.menLed !== undefined && ` · ${r.menLed} men-led`}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {r.files.map((f) => (
            <button
              key={f.hash}
              type="button"
              onClick={() => void openReceipt(f.hash, user?.id)}
              className="min-h-11 border border-line px-2 py-1 text-start text-xs font-semibold text-forest hover:bg-ochre-soft"
            >
              {f.name}
              {r.captions?.[f.hash] && <span className="block font-normal text-muted">Photo in the report: {r.captions[f.hash]}</span>}
            </button>
          ))}
          {(r.links ?? []).map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft">
              {l.title} <span aria-hidden>↗</span>
            </a>
          ))}
          {r.distribution && (
            <a href={`/approve/${encodeURIComponent(project.id)}/${r.distribution}`} className="inline-flex min-h-11 items-center gap-1 border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft">
              Distribution record: signed note and approval <span aria-hidden>→</span>
            </a>
          )}
          {r.planting && (
            <a href={`/field/farmers/${encodeURIComponent(r.planting)}`} className="inline-flex min-h-11 items-center gap-1 border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft">
              Planting record: farmer <span className="font-mono">{r.planting}</span> <span aria-hidden>→</span>
            </a>
          )}
          {!proofCount(r) && r.noFile && <span className="self-center text-xs text-clay">No file: {r.noFile}</span>}
          {mayAddProof && !adding && (
            <button type="button" className="min-h-11 px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft" onClick={() => setAdding(true)}>
              + Add proof
            </button>
          )}
        </div>
        {adding && <AddProof r={r} act={act} onClose={() => setAdding(false)} />}
        <p className="mt-2 text-xs text-muted">
          {r.kobo ? (
            <>
              From KoboToolbox
              {r.kobo.id && (
                <>
                  , submission <span className="font-mono">{r.kobo.id}</span>
                </>
              )}
            </>
          ) : (
            `Recorded by ${r.byName ?? r.by}`
          )}
          {r.reviewedBy && ` · ${r.status === "accepted" ? "accepted" : "queried"} by ${r.reviewedByName ?? r.reviewedBy}`}
          {r.koboChanged && <span className="font-semibold text-clay"> · Changed in KoboToolbox since it was accepted: reopen it to check the new figure</span>}
          {/* A field's exact location is personal data: only for people who see participants' names. */}
          {r.gps && user?.pii && (
            <>
              {" · "}
              <a href={`https://www.openstreetmap.org/?mlat=${r.gps.lat}&mlon=${r.gps.lon}#map=15/${r.gps.lat}/${r.gps.lon}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-forest hover:underline">
                where it was recorded ↗
              </a>
            </>
          )}
        </p>
        {r.query && <p className="mt-1 bg-clay-soft px-3 py-2 text-sm text-clay">MEL asked: {r.query}</p>}
        {r.status === "queried" && r.by === me && !correcting && (
          <button type="button" className={`${primaryBtn} mt-2`} onClick={() => setCorrecting(true)}>
            Correct and resubmit
          </button>
        )}
        {correcting && <CorrectForm r={r} act={act} onClose={() => setCorrecting(false)} />}
        {/* Back from its recorder: MEL reads the question and the answer without opening anything. */}
        {r.status === "pending" && lastAnswer && (
          <p className="mt-1 bg-mist px-3 py-2 text-sm">
            MEL asked: {lastAnswer.query ?? "—"}
            <br />
            Answer: {lastAnswer.reply}
            <br />
            <span className="text-xs text-muted">
              {String(lastAnswer.previous.value) !== String(r.value) || String(lastAnswer.previous.date) !== r.date
                ? `It was ${String(lastAnswer.previous.value)} on ${longDate(String(lastAnswer.previous.date))}. It is now ${num(r.value)} on ${longDate(r.date)}.`
                : tx("The figure and the date were not changed.")}
            </span>
          </p>
        )}
        {(r.history ?? []).length > 0 && (
          <details className="mt-2 text-xs text-muted">
            <summary className="flex min-h-11 cursor-pointer items-center">
              Corrected {r.history!.length} {r.history!.length === 1 ? "time" : "times"}
            </summary>
            <ul className="mt-1 space-y-1">
              {r.history!.map((h) => (
                <li key={h.at}>
                  <span className="font-mono">{h.at.slice(0, 10)}</span>: was <span className="font-mono">{String(h.previous.value)}</span> on <span className="font-mono">{String(h.previous.date)}</span>. MEL asked: {h.query ?? "—"}. Reply: {h.reply}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(r.status === "pending" || r.canReopen) && r.checks.length > 0 && (
          <ul className="mt-2 space-y-1 bg-ochre-soft px-3 py-2 text-xs">
            {r.checks.map((c) => (
              <li key={c}>Check: {c}</li>
            ))}
            <li>
              <LookedAt what="dataChecks" />
            </li>
          </ul>
        )}
        {r.canSelfAccept && (
          <div className="mt-3">
            <p className="text-xs text-muted">{t("so.yours")}</p>
            <button type="button" disabled={busy} className={`${primaryBtn} mt-2 min-h-12`} onClick={() => setSelfing(true)}>
              {t("rq.acceptOne")}
            </button>
            {selfing && (
              <SelfConfirmSheet
                what={`${num(r.value)} ${ind?.unit ?? ""} · ${r.date}`}
                onCancel={() => setSelfing(false)}
                onConfirm={(self) => run(() => act({ action: "accept", id: r.id, self }, "Accepted, marked self-approved: it now counts.")).finally(() => setSelfing(false))}
              />
            )}
          </div>
        )}
        {r.canReview && (
          <div className="mt-3">
            {query === null ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={`${primaryBtn} min-h-11`} onClick={() => run(() => act({ action: "accept", id: r.id }, "Accepted: it now counts."))}>
                  Accept
                </button>
                <button type="button" disabled={busy} className={quietBtn} onClick={() => setQuery("")}>
                  Send back with a question
                </button>
              </div>
            ) : (
              <div>
                <label className="text-sm">
                  What needs fixing?
                  <textarea className={input} rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="The attendance sheet shows 38 names, not 45." />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || query.trim().length < 3}
                    className={dangerBtn}
                    onClick={() => run(() => act({ action: "query", id: r.id, note: query }, "Sent back with a question: it goes to the person who recorded it."))}
                  >
                    Send back with a question
                  </button>
                  <button type="button" className={quietBtn} onClick={() => setQuery(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {r.canReopen &&
          (reopen === null ? (
            <button type="button" className="mt-2 min-h-11 text-xs text-muted hover:text-ink" onClick={() => setReopen("")}>
              Reopen: something is wrong with this result
            </button>
          ) : (
            <div className="mt-3">
              <label className="text-sm">
                What is wrong? It goes back to {r.by} and stops counting until you accept it again.
                <textarea className={input} rows={2} value={reopen} onChange={(e) => setReopen(e.target.value)} placeholder="The weekly update shows this installed on 7 October, not in Q3." />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || reopen.trim().length < 10}
                  className={dangerBtn}
                  onClick={() => run(() => act({ action: "reopen", id: r.id, note: reopen }, "Reopened: it goes back to the person who recorded it.").then(() => setReopen(null)))}
                >
                  Reopen
                </button>
                <button type="button" className={quietBtn} onClick={() => setReopen(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
      </article>
    </LedgerRow>
  );
}

/**
 * Results in ruled rows. With `oldestFirst`, the result waiting longest (by when it was recorded)
 * gets the one gold row, and a quiet line under the table says why.
 */
function ResultRows({ list, v, ind, act, label, oldestFirst }: { list: Res[]; v: ResultsView; ind?: Ind; act: (a: ResultAction, msg: string) => Promise<void>; label: string; oldestFirst?: boolean }) {
  const { tx } = useT();
  const oldest = oldestFirst && list.length > 1 ? list.reduce((a, b) => (b.at < a.at ? b : a)) : null;
  return (
    <>
      <LedgerTable cols="minmax(0,1fr)" head={[tx("Result and proof")]} label={label}>
        {list.map((r) => (
          <ResultCard key={r.id} r={r} ind={ind ?? v.indicators.find((i) => i.code === r.indicator)} act={act} mayAddProof={v.mayAddProof} me={v.me} first={oldest?.id === r.id} />
        ))}
      </LedgerTable>
      {oldest && <p className="mt-2 text-xs text-muted">{tx("Shaded: the result waiting longest, recorded {date}.", { date: oldest.at.slice(0, 10) })}</p>}
    </>
  );
}

/** Values for a new result, filled in from the record it comes from. */
type Prefill = { from: string; fields: Partial<Record<"date" | "value" | "female" | "male" | "womenLed" | "menLed" | "province" | "note", string>> };

function RecordForm({ ind, add, onClose, prefill }: { ind: Ind; add: (r: ResultInput) => Promise<void>; onClose: () => void; prefill?: Prefill | null }) {
  // The places on offer follow the project's country (lib/results placesFor).
  const { project: placeProject } = useCurrentProject();
  const d = ind.disaggregation ?? [];
  const bySex = d.includes("sex");
  const byLead = d.includes("women-led or men-led");
  const byCrop = d.includes("crop");
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    value: "",
    female: "",
    male: "",
    youth: "",
    womenLed: "",
    menLed: "",
    district: "",
    crop: "",
    note: "",
    noFile: "",
    ...prefill?.fields,
    // Only a province on the list: anything else is left for the person to pick.
    province: prefill?.fields.province && (placesFor(placeProject.country)?.names ?? [prefill.fields.province]).includes(prefill.fields.province) ? prefill.fields.province : "",
  });
  const [files, setFiles] = useState<Receipt[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<ProofLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const opt = (s: string) => (s.trim() === "" ? undefined : Number(s));

  const submit = async () => {
    setErr("");
    const value = Number(f.value);
    if (!(value > 0)) return setErr(`Enter how many ${ind.unit}.`);
    if (f.note.trim().length < 10) return setErr("Say what was done, where and with whom: it goes into the report.");
    if (bySex && opt(f.female) !== undefined && opt(f.male) !== undefined && ind.unit === "persons" && opt(f.female)! + opt(f.male)! !== value)
      return setErr(`Women and men add up to ${opt(f.female)! + opt(f.male)!}, not ${value}.`);
    setBusy(true);
    try {
      await add({
        indicator: ind.code,
        date: f.date,
        value,
        female: bySex ? opt(f.female) : undefined,
        male: bySex ? opt(f.male) : undefined,
        youth: bySex ? opt(f.youth) : undefined,
        womenLed: byLead ? opt(f.womenLed) : undefined,
        menLed: byLead ? opt(f.menLed) : undefined,
        province: f.province || undefined,
        district: f.district.trim() || undefined,
        crop: byCrop ? f.crop.trim() || undefined : undefined,
        note: f.note.trim(),
        files,
        links: links.length ? links : undefined,
        captions: cleanCaptions(captions, files),
        noFile: files.length || links.length ? undefined : f.noFile.trim() || undefined,
      });
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet className="mt-1">
      {prefill && <p className="mb-3 text-sm text-warn">Filled in from {prefill.from}. Check that this is the right target and every figure before you send it: MEL checks it like any other result.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Date achieved
          <input type="date" className={input} value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={set("date")} />
        </label>
        <label className="text-sm">
          {ind.measure === "sum" ? `How many (${ind.unit})` : ind.measure === "change" ? "The survey's figure" : `The survey's figure (${ind.unit})`}
          <input inputMode="decimal" className={input} value={f.value} onChange={set("value")} />
          {ind.measure === "change" && <span className="mt-1 block text-xs text-muted">The survey&apos;s own figure, e.g. the average income, in the same unit as the baseline ({ind.baseline ?? "not set yet"}). The app works out the change. Attach the survey file as proof.</span>}
          {ind.measure === "latest" && <span className="mt-1 block text-xs text-muted">The survey&apos;s figure, e.g. a share or an average. Attach the survey file as proof.</span>}
        </label>
        <PlaceField className="text-sm" control={input} value={f.province} onChange={set("province")} help />
        <label className="text-sm">
          District
          <input className={input} value={f.district} onChange={set("district")} />
        </label>
        {bySex && (
          <>
            <label className="text-sm">
              Women
              <FieldHelp field="result.sex" />
              <input inputMode="numeric" className={input} value={f.female} onChange={set("female")} />
            </label>
            <label className="text-sm">
              Men
              <input inputMode="numeric" className={input} value={f.male} onChange={set("male")} />
            </label>
            <label className="text-sm">
              Of them, {YOUTH.label.toLowerCase()} (optional)
              <FieldHelp field="result.youth" />
              <input inputMode="numeric" className={input} value={f.youth} onChange={set("youth")} />
            </label>
          </>
        )}
        {byLead && (
          <>
            <label className="text-sm">
              Women-led
              <input inputMode="numeric" className={input} value={f.womenLed} onChange={set("womenLed")} />
            </label>
            <label className="text-sm">
              Men-led
              <input inputMode="numeric" className={input} value={f.menLed} onChange={set("menLed")} />
            </label>
          </>
        )}
        {byCrop && (
          <label className="text-sm">
            Crop
            <input className={input} value={f.crop} onChange={set("crop")} placeholder="Grapes, pomegranate…" />
          </label>
        )}
      </div>
      <label className="mt-3 block text-sm">
        What was done
        <FieldHelp field="result.note" />
        <textarea
          className={input}
          rows={3}
          value={f.note}
          onChange={set("note")}
          placeholder="Drip irrigation installed on 10 ha for 20 farmers in Nahr-e Saraj and Arghandab; 6 women-headed households."
        />
        <NamesWarning text={f.note} />
      </label>
      <div className="mt-3 text-sm">
        Proof{ind.verification ? ` (${ind.verification})` : ""}
        <FieldHelp field="result.proof" />
        <ProofPicker files={files} setFiles={setFiles} captions={captions} setCaptions={setCaptions} setErr={setErr} setBusy={setBusy} />
        <LinkPicker links={links} setLinks={setLinks} />
        {!files.length && !links.length && (
          <label className="mt-2 block">
            No file yet? Say why
            <input className={input} value={f.noFile} onChange={set("noFile")} placeholder="Verification report due after the field visit on 12 Oct" />
          </label>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {err}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => void submit()}>
          Record
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Many results at once from a spreadsheet: checked row by row here, then all saved as pending for MEL. */
function ImportResults({ indicators, act }: { indicators: { code: string; donorCode: string | null; name: string }[]; act: (a: ResultAction, msg: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const read = async (f: File) => {
    setErr("");
    setRows(null);
    setFile(f.name);
    try {
      const grid = /\.csv$/i.test(f.name) ? parseCsv(await f.text()) : ((await readWorkbook(await f.arrayBuffer()))[0]?.grid ?? []);
      const out = readResults(grid, indicators, new Date().toISOString().slice(0, 10));
      if (out.missing.length) return setErr(`The sheet needs columns for: ${out.missing.join(", ")}. Use the template.`);
      if (!out.rows.length) return setErr("No result rows found under the header.");
      setRows(out.rows);
    } catch (e) {
      setErr(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const bad = rows?.filter((r) => r.errors.length) ?? [];
  const good = rows?.filter((r) => r.result) ?? [];
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;
  if (!open)
    return (
      <p className="mt-6 text-sm">
        <button type="button" className="min-h-11 font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>
          Import many results from a spreadsheet
        </button>{" "}
        <span className="text-muted">for a backlog of past quarters</span>
      </p>
    );
  return (
    <section className="mt-8">
      <SectionHead className="">Import results</SectionHead>
      <Sheet className="mt-3">
        <p className="text-sm text-muted">
          One row per result. The target may be the app&rsquo;s code (IND-7) or the donor&rsquo;s (1.2.1.4). Each row is checked as if typed in, and nothing is saved until every row passes. Imported
          results wait for MEL like any other.{" "}
          <a href={template} download="results-template.csv" className="font-semibold text-forest hover:underline">
            Download the template
          </a>
        </p>
        <input type="file" accept=".xlsx,.csv" className="mt-3 block min-h-11 text-sm" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} aria-label="Spreadsheet of results" />
        {err && <p className="mt-2 text-sm text-clay">{err}</p>}
        {rows && (
          <>
            <p className="mt-3 text-sm">
              <span className="font-mono">{good.length}</span> of <span className="font-mono">{rows.length}</span> rows ready{bad.length ? `; fix ${bad.length} in the sheet and choose it again` : ""}.
            </p>
            {bad.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto border-y border-line py-2 text-xs text-clay">
                {bad.map((r) => (
                  <li key={r.row}>
                    Row <span className="font-mono">{r.row}</span>: {r.errors.join("; ")}
                  </li>
                ))}
              </ul>
            )}
            {good.length > 0 && !bad.length && (
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto border-y border-line py-2 font-mono text-xs">
                {good.map((r) => (
                  <li key={r.row}>
                    Row {r.row}: {r.result!.indicator} · {r.result!.date} · {r.result!.value.toLocaleString("en-US")}
                    {r.result!.district ? ` · ${r.result!.district}` : ""}
                    {proofCount(r.result!) ? "" : " · proof to link"}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryBtn}
            disabled={busy || !good.length || bad.length > 0}
            onClick={() => {
              setBusy(true);
              void act({ action: "import", results: good.map((r) => r.result!), file }, `${good.length} results imported. MEL will check them.`)
                .then(() => {
                  setOpen(false);
                  setRows(null);
                })
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            Import {good.length || ""} results
          </button>
          <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}

/**
 * The top of Results, by who is looking: record a result (field staff), what is waiting for MEL,
 * what MEL queried of yours, and accepted results still without proof.
 */
/**
 * The one "To check" place: what waits for a decision, in two parts (results typed into the app;
 * KoboCollect field forms). The buttons that decide many at once are at the top; each part's
 * records stay folded behind "Review N" until opened. "N waiting for you" counts only what this
 * person may decide.
 */
function ToCheck({ v, waiting, f, act, onReview }: { v: ResultsView | null; waiting: Res[]; f: FieldForms; act: (a: ResultAction, msg: string) => Promise<void>; onReview: (ids: string[]) => void }) {
  const { t } = useT();
  const [openTyped, setOpenTyped] = useState(false);
  // Home's "Check N field forms" lands on #field-records: open them.
  const [openForms, setOpenForms] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#field-records") setOpenForms(true);
  }, []);
  const clean = v?.results.filter((r) => r.canReview && r.checks.length === 0) ?? [];
  const flagged = v?.results.filter((r) => r.canReview && r.checks.length > 0) ?? [];
  const forms = f.show ? f.forMe : 0;
  const mine = waiting.length + forms;
  const others = (v?.results.filter((r) => r.status === "pending" && !r.canReview && !r.canSelfAccept).length ?? 0) + (f.show ? f.pending.length - f.forMe : 0);
  const bulk = clean.length > 0 || flagged.length > 0 || (f.show && f.clean.length > 1);
  return (
    <section id="to-check" className="mt-8 scroll-mt-24">
      <SectionHead
        className=""
        aside={
          <p className={`text-sm ${mine ? "font-semibold text-warn" : "text-muted"}`}>
            {mine ? (
              <>
                <span className="font-mono">{mine}</span> waiting for you
              </>
            ) : (
              "Nothing waiting for you"
            )}
            {others > 0 && (
              <span className="font-normal text-muted">
                {" "}
                · <span className="font-mono">{others}</span> waiting on someone else
              </span>
            )}
          </p>
        }
      >
        To check
      </SectionHead>

      {bulk && (
        <div className="mt-3 border-y border-ink">
          {/* Typed-in results: accept what the data checker found nothing in, review the rest one at a time. */}
          {clean.length + flagged.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-paper px-3 py-2 text-sm">
              <span className="font-semibold">Typed-in results: {t("rq.line", { clean: clean.length, flagged: flagged.length })}</span>
              <span className="flex flex-wrap gap-2 sm:ms-auto">
                {clean.length > 0 && (
                  <button
                    type="button"
                    className={`${primaryBtn} min-h-12`}
                    onClick={() => void askConfirm({ message: t("rq.confirm", { n: clean.length }), confirm: t("rq.accept", { n: clean.length }) }).then((ok) => (ok ? act({ action: "accept-many", ids: clean.map((r) => r.id) }, t("rq.accepted", { n: clean.length })).catch(() => undefined) : undefined))}
                  >
                    {t("rq.accept", { n: clean.length })}
                  </button>
                )}
                {flagged.length > 0 && (
                  <button type="button" className={`${quietBtn} min-h-12`} onClick={() => onReview(flagged.map((r) => r.id))}>
                    Go through {flagged.length} flagged, one at a time
                  </button>
                )}
              </span>
            </div>
          )}
          {f.show && f.clean.length > 1 && (
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 bg-mist px-3 py-2 text-sm ${clean.length + flagged.length > 0 ? "border-t border-line" : ""}`}>
              <span className="font-semibold">Field forms: {f.clean.length} have no problems flagged.</span>
              <button type="button" disabled={!!f.busy} onClick={() => void f.decide(f.clean, "accepted")} className={`${primaryBtn} min-h-12 sm:ms-auto`}>
                Accept all {f.clean.length}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Part 1: results typed into the app (or imported from a sheet), each with its proof. */}
      <div className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-ledger text-base font-bold">
              Typed-in results · <span className="font-mono">{waiting.length}</span> for you
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted">Results recorded in the app with their proof. Once accepted they count in Progress and in the donor report.</p>
          </div>
          {waiting.length > 0 && (
            <button type="button" aria-expanded={openTyped} aria-controls="to-check-typed" onClick={() => setOpenTyped(!openTyped)} className={`${quietBtn} min-h-11`}>
              {openTyped ? "Hide" : `Review ${waiting.length}`}
            </button>
          )}
        </div>
        {!v && <p className="mt-2 text-sm text-muted">{t("load.wait")}</p>}
        {v && openTyped && waiting.length > 0 && (
          <div id="to-check-typed">
            <ResultRows list={waiting} v={v} act={act} label="Typed-in results" oldestFirst />
          </div>
        )}
      </div>

      {/* Part 2: KoboCollect field forms (readiness, training, farm visits). */}
      <FieldRecords f={f} open={openForms} onToggle={() => setOpenForms(!openForms)} />
    </section>
  );
}

function WhatNeedsDoing({ v, me, onRecord }: { v: ResultsView; me: string; onRecord: (code: string) => void }) {
  const { t } = useT();
  const [pick, setPick] = useState("");
  const pending = v.results.filter((r) => r.status === "pending").length;
  const queriedMine = v.results.filter((r) => r.status === "queried" && r.by === me).length;
  const year = new Date().toISOString().slice(0, 4);
  const noProof = v.results.filter((r) => r.status === "accepted" && r.date >= `${year}-01-01` && !proofCount(r)).length;
  return (
    <section className="mt-6">
      {v.mayRecord && v.indicators.some((i) => !i.fromKobo) && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) onRecord(pick);
          }}
        >
          <select id="record-pick" value={pick} onChange={(e) => setPick(e.target.value)} className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 py-2.5 text-sm" aria-label={t("pw.whichTarget")}>
            <option value="">{t("pw.whichTarget")}</option>
            {v.indicators.filter((i) => !i.fromKobo).map((i) => (
              <option key={i.code} value={i.code}>
                {i.donorCode ?? i.code} {i.name}
              </option>
            ))}
          </select>
          <button type="submit" className={primaryBtn} disabled={!pick}>
            Record a result
          </button>
        </form>
      )}
      <Figures
        className={v.mayRecord ? "mt-4" : ""}
        items={[
          { label: "Waiting for MEL", value: pending, tone: pending ? "warn" : undefined },
          ...(queriedMine > 0 ? [{ label: "Of yours queried: answer them below", value: queriedMine, tone: "clay" as const }] : []),
          { label: "Accepted this year with no proof attached", value: noProof, tone: noProof ? "clay" : undefined },
        ]}
      />
    </section>
  );
}

/** Flagged results, one at a time: the reason in a line, Accept and Send back as large buttons, then the next. */
function ReviewQueue({ ids, v, act, onClose }: { ids: string[]; v: ResultsView; act: (a: ResultAction, msg: string) => Promise<void>; onClose: () => void }) {
  const { t } = useT();
  const { user } = useRequireUser();
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The next still waiting for a decision; decided ones drop out as the view refreshes.
  const left = ids.filter((id) => v.results.some((r) => r.id === id && r.canReview));
  const r = v.results.find((x) => x.id === left[0]);
  const k = ids.length - left.length + 1;
  const ind = r && v.indicators.find((i) => i.code === r.indicator);
  const decide = async (a: ResultAction, msg: string) => {
    setBusy(true);
    try {
      await act(a, msg);
      setQuery(null);
      setMore(false);
    } catch {
      /* the error shows at the top */
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6" aria-live="polite">
      <Sheet className="">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-warn">{r ? t("rq.of", { k, n: ids.length }) : ""}</p>
          <button type="button" className="min-h-11 text-sm font-semibold text-forest hover:underline" onClick={onClose}>
            {t("rq.back")}
          </button>
        </div>
        {!r ? (
          <p className="mt-2 text-sm text-leaf">{t("rq.done")}</p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted">
              {ind ? (
                <>
                  <span className="font-mono">{ind.donorCode ?? ind.code}</span>: {ind.name}
                </>
              ) : (
                <span className="font-mono">{r.indicator}</span>
              )}
            </p>
            <p className="mt-1 font-ledger text-lg">
              <span className="font-mono font-bold tabular-nums">{num(r.value)}</span> {ind?.unit} · <span className="font-mono text-base">{r.date}</span>
              {r.district || r.province ? ` · ${[r.district, r.province].filter(Boolean).join(", ")}` : ""}
            </p>
            <p className="mt-1 line-clamp-3 text-sm">{r.note}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.files.map((f) => (
                <button key={f.hash} type="button" onClick={() => void openReceipt(f.hash, user?.id)} className="min-h-11 border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft">
                  {f.name}
                </button>
              ))}
              {(r.links ?? []).map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-ochre-soft">
                  {l.title} <span aria-hidden>↗</span>
                </a>
              ))}
            </div>
            <div className="mt-3 bg-ochre-soft px-3 py-2 text-sm">
              <p>
                <span aria-hidden>⚠ </span>
                {r.checks[0]}
                {r.checks.length > 1 && !more && (
                  <button type="button" className="ms-2 min-h-11 font-semibold text-forest hover:underline" onClick={() => setMore(true)}>
                    {t("rq.more", { n: r.checks.length - 1 })}
                  </button>
                )}
              </p>
              {more && (
                <ul className="mt-1 list-disc ps-5">
                  {r.checks.slice(1).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              <LookedAt what="dataChecks" className="mt-2" />
            </div>
            {query === null ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" disabled={busy} className={`${primaryBtn} min-h-14 text-base`} onClick={() => void decide({ action: "accept", id: r.id }, "Accepted: it now counts.")}>
                  {t("rq.acceptOne")}
                </button>
                <button type="button" disabled={busy} className={`${quietBtn} min-h-14 text-base`} onClick={() => setQuery("")}>
                  {t("rq.query")}
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <label className="text-sm">
                  {t("rq.what")}
                  <textarea className={input} rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="The attendance sheet shows 38 names, not 45." autoFocus />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button type="button" disabled={busy || query.trim().length < 3} className={`${dangerBtn} min-h-12`} onClick={() => void decide({ action: "query", id: r.id, note: query }, "Sent back with a question: it goes to the person who recorded it.")}>
                    {t("rq.send")}
                  </button>
                  <button type="button" className={`${quietBtn} min-h-12`} onClick={() => setQuery(null)}>
                    {t("rq.cancel")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </section>
  );
}
