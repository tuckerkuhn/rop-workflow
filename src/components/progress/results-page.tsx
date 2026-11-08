"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Receipt } from "@/lib/expense";
import { PROVINCES, proofCount, proofLinkSchema, quarterOf, quarterRange, totalsOf, type ProofLink, type ResultAction, type ResultInput, type UpdateInput } from "@/lib/results";
import type { ResultsView } from "@/app/api/projects/[code]/results/route";

/**
 * Results recorded with their proof. Field staff record what was achieved (10 ha of drip
 * irrigation in Helmand, 45 women trained in Kandahar) with the attendance sheet, photos or
 * verification report attached; MEL accepts or queries it; only accepted results count in
 * Progress and the donor report. `?indicator=IND-3&q=2026-Q3` opens the records behind one figure.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const STATUS = { pending: { tone: "ochre", text: "Waiting for MEL" }, accepted: { tone: "forest", text: "Accepted" }, queried: { tone: "clay", text: "Queried" } } as const;

type Ind = ResultsView["indicators"][number];
type Res = ResultsView["results"][number];

export function ResultsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const [v, setV] = useState<ResultsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get("indicator"));
  const quarter = params.get("q");
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
  const waiting = v?.results.filter((r) => r.canReview) ?? [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const [pf, pt] = [params.get("from") ?? "", params.get("to") ?? ""];
  const range = quarter && /^\d{4}-Q[1-4]$/.test(quarter) ? quarterRange(quarter) : iso.test(pf) && iso.test(pt) ? { from: pf, to: pt } : null;
  const rangeLabel = quarter ?? (range ? `${range.from} to ${range.to}` : "");

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Results and their proof</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Record each result with the attendance sheet, photos or verification report that proves it. MEL checks it; once accepted it counts in Progress and in the donor report, and every figure there opens these records.
        </p>
        <p className="mt-2 flex gap-4 text-sm">
          <Link href="/progress" className="font-semibold text-forest hover:underline">
            Progress and report
          </Link>
        </p>
        {!project.saved && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Choose a project saved in the database (for example ACRP).</p>}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && !v.indicators.length && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">This project has no indicators that take recorded results.</p>}

        {range && (
          <p className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-sunken px-4 py-3 text-sm">
            Showing {quarter ? `${quarter} (${range.from} to ${range.to})` : rangeLabel} only.
            <Link href={`/progress/results${open ? `?indicator=${open}` : ""}`} className="font-semibold text-forest hover:underline">
              Show all
            </Link>
          </p>
        )}

        {v && waiting.length > 0 && (
          <section className="mt-6">
            <SectionLabel>To check ({waiting.length})</SectionLabel>
            <div className="mt-3 space-y-3">
              {waiting.map((r) => (
                <ResultCard key={r.id} r={r} ind={v.indicators.find((i) => i.code === r.indicator)} act={act} mayAddProof={v.mayAddProof} me={v.me} />
              ))}
            </div>
          </section>
        )}

        {v &&
          groups.map(([output, list]) => (
            <section key={output} className="mt-8">
              <SectionLabel>{output || "Indicators"}</SectionLabel>
              <ul className="mt-3 space-y-3">
                {list.map((i) => {
                  const mine = v.results.filter((r) => r.indicator === i.code && (!range || (r.date >= range.from && r.date <= range.to)));
                  const all = totalsOf(v.results.filter((r) => r.indicator === i.code));
                  const shown = totalsOf(mine);
                  const pending = mine.filter((r) => r.status === "pending").length;
                  const isOpen = open === i.code;
                  return (
                    <li key={i.code} id={`ind-${i.code}`} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-4">
                      <button type="button" className="flex w-full items-start gap-3 text-start" onClick={() => setOpen(isOpen ? null : i.code)} aria-expanded={isOpen}>
                        <span className="shrink-0 font-mono text-xs text-muted">{i.donorCode ?? i.code}</span>
                        <span className="flex-1 font-medium leading-snug">{i.name}</span>
                        <span className="shrink-0 text-end">
                          <span className="font-display text-2xl tabular-nums">{num(range ? shown.value : all.value)}</span>
                          <span className="block text-xs text-muted">
                            {range ? `in ${rangeLabel}` : `of ${num(i.target)} ${i.unit}`}
                          </span>
                        </span>
                      </button>
                      <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>
                          {shown.records} accepted record{shown.records === 1 ? "" : "s"} · {shown.files} file{shown.files === 1 ? "" : "s"}
                        </span>
                        {shown.female + shown.male > 0 && (
                          <span>
                            {num(shown.female)} women · {num(shown.male)} men
                          </span>
                        )}
                        {pending > 0 && <span className="text-ochre">{pending} waiting for MEL</span>}
                        {i.verification && <span>Proof: {i.verification}</span>}
                      </p>
                      {isOpen && (
                        <div className="mt-4 space-y-3 border-t border-line pt-4">
                          {adding === i.code ? (
                            <RecordForm ind={i} onClose={() => setAdding(null)} add={(r) => act({ action: "record", result: r }, "Recorded. MEL will check it.").then(() => setAdding(null))} />
                          ) : (
                            v.mayRecord && (
                              <button type="button" className={quietBtn} onClick={() => setAdding(i.code)}>
                                Record a result
                              </button>
                            )
                          )}
                          {!mine.length && <p className="text-sm text-muted">Nothing recorded{range ? ` in ${rangeLabel}` : ""} yet.</p>}
                          {mine.map((r) => (
                            <ResultCard key={r.id} r={r} ind={i} act={act} mayAddProof={v.mayAddProof} me={v.me} />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

        {v && v.activities.length > 0 && (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="font-display text-2xl">Activity updates</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Progress that is not a count on an indicator: reservoirs built, grant agreements signed, sales at an exhibition, an analysis finished. Add photos with a caption to put them in the donor report. Updates go into the report&rsquo;s narrative; they never change a figure.
            </p>
            {v.mayUpdate && !addingUpdate && (
              <button type="button" className={`${quietBtn} mt-3`} onClick={() => setAddingUpdate(true)}>
                Add an update
              </button>
            )}
            {addingUpdate && <UpdateForm activities={v.activities} onClose={() => setAddingUpdate(false)} add={(u) => act({ action: "update", update: u }, "Update added.").then(() => setAddingUpdate(false))} />}
            {v.activities.map((a) => {
              const list = v.updates.filter((u) => u.activity === a.code && (!range || (u.date >= range.from && u.date <= range.to)));
              if (!list.length) return null;
              return (
                <div key={a.code} className="mt-5">
                  <SectionLabel>
                    Activity {a.code}: {a.name}
                  </SectionLabel>
                  <div className="mt-2 space-y-2">
                    {list.map((u) => (
                      <article key={u.id} className="rounded-xl border border-line bg-paper p-3 text-sm">
                        <p className="text-xs text-muted">
                          {u.date} · {u.quarter} · by {u.by}
                        </p>
                        <p className="mt-1 whitespace-pre-line">{u.note}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {u.files.map((f) => (
                            <button key={f.hash} type="button" onClick={() => void openReceipt(f.hash, user.id)} className="rounded-lg border border-line px-2 py-1 text-start text-xs font-semibold text-forest hover:bg-sunken">
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
  const out = Object.fromEntries(Object.entries(c).filter(([h, v]) => v.trim() && files.some((f) => f.hash === h && f.type.startsWith("image/"))).map(([h, v]) => [h, v.trim()]));
  return Object.keys(out).length ? out : undefined;
};

/** Upload photos and documents; each photo can get a caption, and captioned photos go into the donor report. */
function ProofPicker({ files, setFiles, captions, setCaptions, setErr, setBusy }: { files: Receipt[]; setFiles: (f: Receipt[] | ((c: Receipt[]) => Receipt[])) => void; captions: Record<string, string>; setCaptions: (c: Record<string, string>) => void; setErr: (s: string) => void; setBusy: (b: boolean) => void }) {
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
      <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1 block text-sm" onChange={(e) => void upload(e.target.files)} />
      {files.length > 0 && (
        <ul className="mt-2 space-y-2">
          {files.map((x) => (
            <li key={x.hash} className="rounded-lg border border-line bg-paper px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                <span className="flex-1">{x.name}</span>
                <button type="button" aria-label={`Remove ${x.name}`} className="text-muted hover:text-clay" onClick={() => setFiles(files.filter((y) => y.hash !== x.hash))}>
                  ×
                </button>
              </span>
              {x.type.startsWith("image/") && (
                <input className={input} placeholder="Caption, to put this photo in the report: what, where, when" value={captions[x.hash] ?? ""} onChange={(e) => setCaptions({ ...captions, [x.hash]: e.target.value })} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UpdateForm({ activities, add, onClose }: { activities: { code: string; name: string }[]; add: (u: UpdateInput) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ activity: activities[0]?.code ?? "", date: new Date().toISOString().slice(0, 10), note: "" });
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
    <div className="mt-3 rounded-xl bg-sunken p-4">
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
        <textarea className={input} rows={4} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="10 of the 15 planned water reservoirs completed in Nesh, Maiwand, Musa Qala and Sangin (about 121 m³ each)." />
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
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => void submit()}>
          Add update
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
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
      <span className="block text-xs text-muted">Or link a document in SharePoint (open it, then Copy link)</span>
      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What it is: attendance sheet, 27–30 Jul" aria-label="Document title" />
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://rootsofpeace.sharepoint.com/…" aria-label="Document link" inputMode="url" />
        <button type="button" className={`${quietBtn} mt-1`} onClick={add}>
          Add link
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-clay">{err}</p>}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map((l) => (
            <li key={l.url} className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {l.title} <span className="text-muted">· {l.url}</span>
              </span>
              <button type="button" aria-label={`Remove ${l.title}`} className="text-muted hover:text-clay" onClick={() => setLinks(links.filter((x) => x.url !== l.url))}>
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
    <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
      <span className="font-semibold">Add proof</span>
      <ProofPicker files={files} setFiles={setFiles} captions={captions} setCaptions={setCaptions} setErr={setErr} setBusy={setBusy} />
      <LinkPicker links={links} setLinks={setLinks} />
      {err && <p className="mt-2 text-xs text-clay">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy || files.length + links.length === 0} className={primaryBtn} onClick={() => void save()}>
          Save proof
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The recorder answers MEL's query: corrected figures and a note on what changed. */
function CorrectForm({ r, act, onClose }: { r: Res; act: (a: ResultAction, msg: string) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ date: r.date, value: String(r.value), female: r.female?.toString() ?? "", male: r.male?.toString() ?? "", womenLed: r.womenLed?.toString() ?? "", menLed: r.menLed?.toString() ?? "", province: r.province ?? "", district: r.district ?? "", note: r.note });
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
          changes: { date: f.date, value: Number(f.value), female: opt(f.female), male: opt(f.male), womenLed: opt(f.womenLed), menLed: opt(f.menLed), province: f.province || undefined, district: f.district.trim() || undefined, note: f.note.trim() },
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
  const box = "mt-1 w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-sm";
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-sm">
      <span className="font-semibold">Correct and resubmit</span>
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
        <label className="text-xs text-muted">
          Province
          <select className={box} value={f.province} onChange={set("province")}>
            <option value="">—</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
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
      <div className="mt-3 flex gap-2">
        <button type="button" className={primaryBtn} disabled={busy || reply.trim().length < 5} onClick={() => void save()}>
          Send back to MEL
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResultCard({ r, ind, act, mayAddProof, me }: { r: Res; ind?: Ind; act: (a: ResultAction, msg: string) => Promise<void>; mayAddProof: boolean; me: string }) {
  const { user } = useSession();
  const [query, setQuery] = useState<string | null>(null);
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
  return (
    <article className="rounded-xl border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>
        <span className="font-semibold tabular-nums">
          {num(r.value)} {ind?.unit}
        </span>
        <span className="text-muted">
          {r.date} · {quarterOf(r.date)}
          {place && ` · ${place}`}
          {r.crop && ` · ${r.crop}`}
        </span>
      </div>
      {ind && !r.canReview ? null : ind && <p className="mt-1 text-xs text-muted">{ind.donorCode ?? ind.code}: {ind.name}</p>}
      <p className="mt-2 whitespace-pre-line text-sm">{r.note}</p>
      {(r.female !== undefined || r.male !== undefined || r.womenLed !== undefined || r.menLed !== undefined) && (
        <p className="mt-1 text-xs text-muted">
          {r.female !== undefined && `${r.female} women`}
          {r.male !== undefined && ` · ${r.male} men`}
          {r.womenLed !== undefined && ` · ${r.womenLed} women-led`}
          {r.menLed !== undefined && ` · ${r.menLed} men-led`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.files.map((f) => (
          <button key={f.hash} type="button" onClick={() => void openReceipt(f.hash, user?.id)} className="rounded-lg border border-line px-2 py-1 text-start text-xs font-semibold text-forest hover:bg-sunken">
            {f.name}
            {r.captions?.[f.hash] && <span className="block font-normal text-muted">Photo in the report: {r.captions[f.hash]}</span>}
          </button>
        ))}
        {(r.links ?? []).map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-forest hover:bg-sunken">
            {l.title} <span aria-hidden>↗</span>
          </a>
        ))}
        {!proofCount(r) && r.noFile && <span className="text-xs text-clay">No file: {r.noFile}</span>}
        {mayAddProof && !adding && (
          <button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold text-forest hover:bg-sunken" onClick={() => setAdding(true)}>
            + Add proof
          </button>
        )}
      </div>
      {adding && <AddProof r={r} act={act} onClose={() => setAdding(false)} />}
      <p className="mt-2 text-xs text-muted">
        Recorded by {r.by}
        {r.reviewedBy && ` · ${r.status === "accepted" ? "accepted" : "queried"} by ${r.reviewedBy}`}
      </p>
      {r.query && <p className="mt-1 rounded-lg bg-clay-soft px-3 py-2 text-sm text-clay">MEL asked: {r.query}</p>}
      {r.status === "queried" && r.by === me && !correcting && (
        <button type="button" className={`${primaryBtn} mt-2`} onClick={() => setCorrecting(true)}>
          Correct and resubmit
        </button>
      )}
      {correcting && <CorrectForm r={r} act={act} onClose={() => setCorrecting(false)} />}
      {(r.history ?? []).length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Corrected {r.history!.length} {r.history!.length === 1 ? "time" : "times"}</summary>
          <ul className="mt-1 space-y-1">
            {r.history!.map((h) => (
              <li key={h.at}>
                {h.at.slice(0, 10)}: was {String(h.previous.value)} on {String(h.previous.date)}. MEL asked: {h.query ?? "—"}. Reply: {h.reply}
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.status === "pending" && r.checks.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-ochre-soft px-3 py-2 text-xs">
          {r.checks.map((c) => (
            <li key={c}>Check: {c}</li>
          ))}
        </ul>
      )}
      {r.canReview && (
        <div className="mt-3">
          {query === null ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => run(() => act({ action: "accept", id: r.id }, "Accepted: it now counts."))}>
                Accept
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setQuery("")}>
                Query
              </button>
            </div>
          ) : (
            <div>
              <label className="text-sm">
                What needs fixing?
                <textarea className={input} rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="The attendance sheet shows 38 names, not 45." />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy || query.trim().length < 3} className={dangerBtn} onClick={() => run(() => act({ action: "query", id: r.id, note: query }, "Queried: it goes back to the person who recorded it."))}>
                  Send query
                </button>
                <button type="button" className={quietBtn} onClick={() => setQuery(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RecordForm({ ind, add, onClose }: { ind: Ind; add: (r: ResultInput) => Promise<void>; onClose: () => void }) {
  const d = ind.disaggregation ?? [];
  const bySex = d.includes("sex");
  const byLead = d.includes("women-led or men-led");
  const byCrop = d.includes("crop");
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), value: "", female: "", male: "", womenLed: "", menLed: "", province: "", district: "", crop: "", note: "", noFile: "" });
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
    if (bySex && opt(f.female) !== undefined && opt(f.male) !== undefined && ind.unit === "persons" && opt(f.female)! + opt(f.male)! !== value) return setErr(`Women and men add up to ${opt(f.female)! + opt(f.male)!}, not ${value}.`);
    setBusy(true);
    try {
      await add({
        indicator: ind.code,
        date: f.date,
        value,
        female: bySex ? opt(f.female) : undefined,
        male: bySex ? opt(f.male) : undefined,
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
    <div className="rounded-xl bg-sunken p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Date achieved
          <input type="date" className={input} value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={set("date")} />
        </label>
        <label className="text-sm">
          How many ({ind.unit})
          <input inputMode="decimal" className={input} value={f.value} onChange={set("value")} />
        </label>
        <label className="text-sm">
          Province
          <select className={input} value={f.province} onChange={set("province")}>
            <option value="">—</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          District
          <input className={input} value={f.district} onChange={set("district")} />
        </label>
        {bySex && (
          <>
            <label className="text-sm">
              Women
              <input inputMode="numeric" className={input} value={f.female} onChange={set("female")} />
            </label>
            <label className="text-sm">
              Men
              <input inputMode="numeric" className={input} value={f.male} onChange={set("male")} />
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
        <textarea className={input} rows={3} value={f.note} onChange={set("note")} placeholder="Drip irrigation installed on 10 ha for 20 farmers in Nahr-e Saraj and Arghandab; 6 women-headed households." />
      </label>
      <div className="mt-3 text-sm">
        Proof{ind.verification ? ` (${ind.verification})` : ""}
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
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => void submit()}>
          Record
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
