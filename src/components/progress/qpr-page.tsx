"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { openReceipt } from "@/components/people/expense-page";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { SECTIONS, STATUSES, STATUS_LABEL, overspentLines, quarterSpendOf, type QprPatch, type Row, type Status } from "@/lib/qpr";
import { qprDocx, type Images } from "@/lib/qpr-docx";
import { formatMinutes } from "@/lib/report-copy";
import { ShareLinks } from "@/components/progress/share-links";
import { ClaimCheckPanel } from "@/components/progress/claim-check";
import { ReportDownloads } from "@/components/progress/downloads";
import { quarterOf, quarterRange } from "@/lib/results";
import type { QprView } from "@/app/api/projects/[code]/qpr/route";

/**
 * The donor's quarterly progress report, in ROP's UNDP layout. Figures come from accepted
 * results and open the records behind them; the team writes the text (Claude can draft it);
 * checks list what to fix before the report goes out; it downloads as a Word document.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const TONE: Record<Status, "forest" | "sky" | "ochre" | "clay" | "muted"> = { completed: "forest", on_track: "sky", delayed: "ochre", not_implemented: "clay", not_started: "muted" };

/** Quarters from the project's start to the last one that has ended (real date, not the demo date). */
function quartersFor(start: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const last = quarterOf(today);
  const out: string[] = [];
  let y = Number((start ?? today).slice(0, 4));
  let q = Number(quarterOf(start ?? today).slice(6));
  for (;;) {
    const k = `${y}-Q${q}`;
    out.push(k);
    if (k === last || out.length > 40) break;
    q = q === 4 ? 1 : q + 1;
    if (q === 1) y++;
  }
  return out.reverse();
}
const lastEnded = () => {
  const today = new Date().toISOString().slice(0, 10);
  const cur = quarterOf(today);
  const [y, n] = [Number(cur.slice(0, 4)), Number(cur.slice(6))];
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};

export function QprPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const router = useRouter();
  const quarter = /^\d{4}-Q[1-4]$/.test(params.get("q") ?? "") ? params.get("q")! : lastEnded();
  const [v, setV] = useState<QprView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const copyAt = params.get("copy");
  const url = `/api/projects/${project.id}/qpr?q=${quarter}${copyAt ? `&copy=${encodeURIComponent(copyAt)}` : ""}`;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<QprView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);

  if (!user) return null;
  const act = async (a: QprPatch, msg: string) => {
    setError("");
    setNotice("");
    setBusy(a.action);
    try {
      const out = await call<QprView & { questions?: string[]; copyAt?: string }>(url, user.id, { method: "POST", body: JSON.stringify(a) });
      setV(out);
      if (out.copyAt) router.replace(`/progress/report?q=${quarter}&copy=${encodeURIComponent(out.copyAt)}`);
      if (out.questions) setQuestions(out.questions);
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy("");
    }
  };
  const quiet = (p: Promise<void>) => p.catch(() => undefined);

  /** Fetches each captioned photo and turns it into a JPEG Word can hold. */
  const loadImages = async (photos: QprView["photos"]): Promise<Images> => {
    const out: Images = new Map();
    for (const ph of photos) {
      try {
        const res = await fetch(`/api/files/${ph.hash}`, { headers: { "x-demo-user": user.id } });
        if (!res.ok) continue;
        const bmp = await createImageBitmap(await res.blob());
        const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
        if (blob) out.set(ph.hash, { data: await blob.arrayBuffer(), width: canvas.width, height: canvas.height });
      } catch {
        /* a photo that cannot be read is marked in the document */
      }
    }
    return out;
  };
  const download = async () => {
    if (!v) return;
    setBusy("download");
    setError("");
    try {
      const blob = await qprDocx({ ...v, origin: window.location.origin }, await loadImages(v.photos));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${v.project.code}-QPR-${v.quarter}${v.frozen?.kind === "practice" ? `-practice-${v.frozen.at.slice(0, 10)}` : ""}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError(`The Word file could not be made: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const emptyDraftable = v ? [...SECTIONS.filter((s) => s.draft).map((s) => s.key as string), ...v.activities.map((a) => `act.${a.code}`)].filter((k) => !v.saved.sections[k]?.text.trim()) : [];
  const stops = v?.checks.filter((c) => c.level === "stop") ?? [];
  const { from, to } = quarterRange(quarter);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-3xl tracking-tight">Quarterly progress report</h1>
          <label className="text-sm">
            Quarter
            <select className={input} value={quarter} onChange={(e) => router.replace(`/progress/report?q=${e.target.value}`)}>
              {quartersFor(v?.project.start ?? null).map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {from} to {to}. Figures come from results MEL has accepted, and each one opens the records and proof behind it. Write or draft the text, fix what the checks list, then download it for Word.
        </p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <Link href="/progress/results" className="font-semibold text-forest hover:underline">
            Results and proof
          </Link>
          <Link href="/progress" className="font-semibold text-forest hover:underline">
            Progress
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
        {v && (
          <>
            <div className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
              {v.frozen?.kind === "practice" ? (
                <Pill tone="sky">Practice copy · {v.frozen.at.slice(0, 16).replace("T", " ")} UTC · {v.frozen.by}</Pill>
              ) : v.saved.released ? (
                <Pill tone="forest">Released {v.saved.released.at.slice(0, 10)} by {v.saved.released.by}</Pill>
              ) : (
                <Pill tone={stops.length ? "clay" : "ochre"}>
                  Draft · {stops.length} to fix · {v.checks.length - stops.length} to check
                </Pill>
              )}
              {v.work.sittings > 0 && (
                <span className="text-xs text-muted" title="Edits less than 30 minutes apart count as one sitting, from its first edit to its last, plus 5 minutes.">
                  {formatMinutes(v.work.minutes)} of work over {v.work.sittings} {v.work.sittings === 1 ? "sitting" : "sittings"}
                  {v.frozen ? " before this copy" : ""}
                </span>
              )}
              <span className="flex-1" />
              {v.mayEdit && emptyDraftable.length > 0 && (
                <button
                  type="button"
                  className={quietBtn}
                  disabled={!!busy || !v.aiReady}
                  title={v.aiReady ? "" : "AI drafting is not set up on this server."}
                  onClick={() => quiet(act({ action: "draft", keys: emptyDraftable }, "Drafted. Read and correct every drafted section before the report goes out."))}
                >
                  {busy === "draft" ? "Drafting… (up to 2 minutes)" : `Draft ${emptyDraftable.length} empty section${emptyDraftable.length === 1 ? "" : "s"} with Claude`}
                </button>
              )}
              <button type="button" className={quietBtn} disabled={busy === "download"} onClick={() => void download()}>
                {busy === "download" ? "Making the Word file…" : "Download for Word"}
              </button>
              {v.mayPractice && (
                <button
                  type="button"
                  className={quietBtn}
                  disabled={!!busy}
                  title="Saves a copy as if released, without locking anything, so you can see what would go out and compare it later."
                  onClick={() => quiet(act({ action: "practice" }, "Practice copy saved. Nothing is locked: go back to the report to keep working."))}
                >
                  Practice release
                </button>
              )}
              {v.mayRelease && (
                <button type="button" className={primaryBtn} disabled={!!busy || stops.length > 0} title={stops.length ? "Fix the items marked to fix first." : ""} onClick={() => window.confirm(`Mark the ${quarter} report final? It is locked for good: this copy is what the donor receives. To rehearse, use Practice release instead.`) && quiet(act({ action: "release" }, "Released: the report is final and can no longer be changed."))}>
                  Mark final
                </button>
              )}
            </div>

            {v.frozen && (
              <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-semibold">
                  {v.frozen.kind === "release"
                    ? `This is the report as released on ${v.frozen.at.slice(0, 10)}: what the donor received. It stays as it was.`
                    : "This is a practice copy: the report as it would have gone out at that moment. Nothing was locked."}
                </p>
                {v.changes.length ? (
                  <>
                    <p className="mt-2 text-muted">Since then:</p>
                    <ul className="mt-1 list-disc ps-5">
                      {v.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                    {v.frozen.kind === "release" && <p className="mt-2 text-muted">Report these corrections to the donor in the next report.</p>}
                  </>
                ) : (
                  <p className="mt-2 text-muted">Nothing has changed since.</p>
                )}
                {v.frozen.kind === "practice" && (
                  <Link href={`/progress/report?q=${quarter}`} className="mt-2 inline-block font-semibold text-forest hover:underline">
                    ← Back to the report
                  </Link>
                )}
              </section>
            )}
            {!v.frozen && v.copies.some((c) => c.kind === "practice") && (
              <p className="mt-3 text-xs text-muted">
                Practice copies:{" "}
                {v.copies
                  .filter((c) => c.kind === "practice")
                  .reverse()
                  .map((c, k) => (
                    <span key={c.at}>
                      {k > 0 && " · "}
                      <Link href={`/progress/report?q=${quarter}&copy=${encodeURIComponent(c.at)}`} className="hover:text-ink hover:underline">
                        {c.at.slice(0, 16).replace("T", " ")} ({formatMinutes(c.minutes)})
                      </Link>
                    </span>
                  ))}
              </p>
            )}

            <ReportDownloads project={project.id} quarter={quarter} user={user.id} mayEvidence={!!user.admin || user.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r))} />
            <ClaimCheckPanel
              check={v.saved.claimCheck}
              sections={Object.fromEntries(Object.entries(v.saved.sections).map(([k, t]) => [k, t?.text ?? ""]))}
              headings={Object.fromEntries([...SECTIONS.map((x) => [x.key, x.heading]), ...v.activities.map((x) => [`act.${x.code}`, `Activity ${x.code}`])])}
              busy={busy === "check-claims"}
              mayRun={v.mayEdit}
              onRun={() => quiet(act({ action: "check-claims" }, "Checked. Look at each finding against its records; nothing has been changed."))}
            />
            {!v.frozen?.kind || v.frozen.kind === "release" ? <ShareLinks project={project.id} quarter={quarter} user={user.id} ready={v.copies.length > 0} /> : null}

            {questions.length > 0 && (
              <section className="mt-4 rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm">
                <p className="font-semibold">Claude needs these facts (placeholders are in [brackets] in the drafts):</p>
                <ul className="mt-1 list-disc ps-5">
                  {questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </section>
            )}

            {v.checks.length > 0 && (
              <details className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm" open={stops.length > 0}>
                <summary className="cursor-pointer font-semibold">Checks before it goes out ({v.checks.length})</summary>
                <ul className="mt-2 space-y-1">
                  {v.checks.map((c) => (
                    <li key={c.text} className="flex gap-2">
                      <span className={c.level === "stop" ? "font-semibold text-clay" : "text-ochre"}>{c.level === "stop" ? "Fix" : "Check"}</span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <InfoBox v={v} act={act} onImported={() => void load()} />
            <Acronyms v={v} act={act} />
            <Section v={v} k="summary" act={act} busy={busy} />
            <Section v={v} k="background" act={act} busy={busy} />

            <section className="mt-8">
              <h2 className="font-display text-2xl">II. Progress Towards Results</h2>
              <IndicatorTable v={v} act={act} />
            </section>

            <section className="mt-8">
              <h2 className="font-display text-2xl">Narrative Description</h2>
              {v.activities.map((a) => (
                <div key={a.code}>
                  <Section v={v} k={`act.${a.code}`} heading={`Activity ${a.code}: ${a.name}`} act={act} busy={busy} draftable />
                  <ActivityExtras v={v} activity={a.code} />
                </div>
              ))}
            </section>

            <section className="mt-8">
              <h2 className="font-display text-2xl">III. Cross-cutting Issues</h2>
              <GenderStrip rows={v.rows} />
              <Section v={v} k="gender" act={act} busy={busy} />
              <Section v={v} k="principled" act={act} busy={busy} />
              <Section v={v} k="partnerships" act={act} busy={busy} />
              <Section v={v} k="safeguards" act={act} busy={busy} />
              <Grm v={v} act={act} />
              <Section v={v} k="grm" act={act} busy={busy} />
              <Section v={v} k="story" act={act} busy={busy} />
            </section>
            <Section v={v} k="challenges" act={act} busy={busy} />
            <Risks v={v} act={act} />
            <Section v={v} k="lessons" act={act} busy={busy} />
            <Section v={v} k="next" act={act} busy={busy} />
          </>
        )}
      </main>
    </div>
  );
}

type Act = (a: QprPatch, msg: string) => Promise<void>;

function InfoBox({ v, act, onImported }: { v: QprView; act: Act; onImported: () => void }) {
  const to = quarterRange(v.quarter).to;
  const [f, setF] = useState(v.saved.info);
  const [spend, setSpend] = useState(v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  useEffect(() => {
    setF(v.saved.info);
    setSpend(v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  }, [v.saved.info, v.saved.quarterSpend]);
  const c = v.spend.currency;
  const dirty = JSON.stringify(f) !== JSON.stringify(v.saved.info) || spend !== (v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  const field = (k: keyof typeof f, label: string, wide = false) => (
    <label className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input className={input} value={f[k] ?? ""} disabled={!v.mayEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
      <SectionLabel>Project information</SectionLabel>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Total budget</dt>
          <dd className="font-semibold tabular-nums">
            {num(v.spend.budget)} {c}
          </dd>
          <dd className="text-xs text-muted">{v.spend.withOverhead ? "Whole agreement, overhead included" : "Overhead not included"}</dd>
        </div>
        <div>
          <dt className="text-muted">Cumulative to {to}</dt>
          <dd className="font-semibold tabular-nums">
            {num(v.spend.cumulative)} {c}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Spent this quarter</dt>
          <dd className="font-semibold tabular-nums">{quarterSpendOf(v.saved, v.spend) === null ? "—" : `${num(quarterSpendOf(v.saved, v.spend)!)} ${c}`}</dd>
          {v.saved.quarterSpend !== null && v.spend.quarter !== null && <dd className="text-xs text-ochre">Typed in; the import says {num(v.spend.quarter)}</dd>}
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        {v.spend.source.kind === "import" ? (
          <>
            From Finance&rsquo;s budget against actual:{" "}
            {v.spend.source.files.map((f, k) => (
              <span key={f.name + f.period}>
                {k > 0 && "; "}
                {f.period}: {f.sharepointUrl ? (
                  <a href={f.sharepointUrl} target="_blank" rel="noreferrer" className="font-semibold text-forest hover:underline">
                    {f.name}
                  </a>
                ) : (
                  f.name
                )}{" "}
                (imported by {f.by} on {f.at})
              </span>
            ))}
            .
          </>
        ) : (
          <>From the budget file{v.spend.source.at ? ` imported on ${v.spend.source.at}` : ""}. Import Finance&rsquo;s monthly workbook to fill this quarter&rsquo;s spending.</>
        )}{" "}
        <SpendImport v={v} onDone={onImported} />
      </p>
      {v.mayEdit && (
        <label className="mt-3 block max-w-xs text-sm">
          <span className="text-muted">Type this quarter&rsquo;s spending instead ({c})</span>
          <input inputMode="decimal" className={input} value={spend} placeholder={v.spend.quarter === null ? "" : `${num(v.spend.quarter)} from the import`} onChange={(e) => setSpend(e.target.value)} />
        </label>
      )}
      <Overspend v={v} act={act} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("title", "Project title", true)}
        {field("agreement", "Agreement number")}
        {field("duration", "Project duration, as in the agreement (e.g. 1 March 2025 – 30 June 2027)")}
        {field("director", "Country director")}
        {field("locations", "Project locations (districts)", true)}
        {field("partner", "Responsible party")}
      </div>
      {v.mayEdit && dirty && (
        <button
          type="button"
          className={`${primaryBtn} mt-3`}
          onClick={() => {
            const q = spend.trim() === "" ? null : Number(spend.replace(/,/g, ""));
            if (q !== null && !Number.isFinite(q)) return;
            void act({ action: "info", info: f, quarterSpend: q }, "Saved.").catch(() => undefined);
          }}
        >
          Save project information
        </button>
      )}
    </section>
  );
}

/** One explanation per budget line spent above its budget; it goes in the report under the project information. */
function Overspend({ v, act }: { v: QprView; act: Act }) {
  const lines = overspentLines(v.spend, v.saved);
  const [text, setText] = useState<Record<string, string>>({});
  if (!lines.length) return null;
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-paper p-3">
      <p className="text-sm font-semibold">Budget lines above budget</p>
      {lines.map((l) => {
        const t = text[l.code] ?? l.explanation;
        return (
          <label key={l.code} className="block text-sm">
            {l.code}: {num(l.actual)} spent of {num(l.budget)} {v.spend.currency} ({l.pct}%). Why?
            <textarea className={input} rows={2} disabled={!v.mayEdit} value={t} placeholder="UNDP approved the realignment on …, or prices rose because …" onChange={(e) => setText({ ...text, [l.code]: e.target.value })} />
            {v.mayEdit && t !== l.explanation && (
              <button type="button" className={`${primaryBtn} mt-2`} disabled={t.trim().length > 0 && t.trim().length < 10} onClick={() => void act({ action: "overspend", line: l.code, text: t.trim() }, "Saved.").catch(() => undefined)}>
                Save
              </button>
            )}
          </label>
        );
      })}
    </div>
  );
}

function Section({ v, k, heading, act, busy, draftable }: { v: QprView; k: string; heading?: string; act: Act; busy: string; draftable?: boolean }) {
  const def = SECTIONS.find((s) => s.key === k);
  const saved = v.saved.sections[k];
  const [text, setText] = useState(saved?.text ?? "");
  useEffect(() => setText(saved?.text ?? ""), [saved?.text]);
  const canDraft = (draftable || def?.draft) && v.mayEdit && v.aiReady;
  const dirty = text !== (saved?.text ?? "");
  const rows = Math.min(18, Math.max(4, Math.ceil(text.length / 95) + text.split("\n").length));
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-display text-lg">{heading ?? def?.heading}</h3>
        {saved?.drafted && <Pill tone="ochre">Drafted by Claude: review</Pill>}
        {saved?.from && <Pill tone="ochre">Copied from {saved.from}: review</Pill>}
        {saved && !saved.drafted && !saved.from && <span className="text-xs text-muted">Saved by {saved.by}</span>}
      </div>
      {def?.help && <p className="text-xs text-muted">{def.help}</p>}
      {v.mayEdit ? (
        <>
          <textarea className={input} rows={rows} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex gap-2">
            {dirty && (
              <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => void act({ action: "section", key: k, text }, "Saved.").catch(() => undefined)}>
                Save
              </button>
            )}
            {canDraft && (
              <button
                type="button"
                className={quietBtn}
                disabled={!!busy}
                onClick={() => {
                  if (text.trim() && !window.confirm("Replace this text with a new draft?")) return;
                  void act({ action: "draft", keys: [k] }, "Drafted. Read and correct it before the report goes out.").catch(() => undefined);
                }}
              >
                {busy === "draft" ? "Drafting…" : text.trim() ? "Redraft with Claude" : "Draft with Claude"}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="mt-1 whitespace-pre-line text-sm">{saved?.text || <span className="text-muted">Not written yet.</span>}</p>
      )}
    </section>
  );
}

function IndicatorTable({ v, act }: { v: QprView; act: Act }) {
  const outputs = [...new Set(v.rows.map((r) => r.output))];
  const year = v.quarter.slice(0, 4);
  const qn = v.quarter.slice(5);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-start text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pe-3 text-start">Output indicator</th>
            <th className="py-2 pe-3 text-end">{year} target</th>
            <th className="py-2 pe-3 text-end">{qn} achieved</th>
            <th className="py-2 pe-3 text-end">This year</th>
            <th className="py-2 pe-3 text-start">Status and comment</th>
          </tr>
        </thead>
        {outputs.map((o) => (
          <tbody key={o} className="divide-y divide-line">
            <tr>
              <td colSpan={5} className="bg-sunken px-2 py-2 font-semibold">
                {o}
              </td>
            </tr>
            {v.rows
              .filter((r) => r.output === o)
              .map((r) => (
                <IndicatorRow key={r.code} r={r} v={v} act={act} />
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function IndicatorRow({ r, v, act }: { r: Row; v: QprView; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>(r.status);
  const [comment, setComment] = useState(r.comment);
  useEffect(() => {
    setStatus(r.status);
    setComment(r.comment);
  }, [r.status, r.comment]);
  const { from, to } = quarterRange(v.quarter);
  const yearFrom = `${v.quarter.slice(0, 4)}-01-01`;
  const evidence = (f: string, text: string, records: number) => (
    <Link href={`/progress/results?indicator=${r.code}&from=${f}&to=${to}`} className="font-semibold tabular-nums text-forest underline decoration-dotted underline-offset-4 hover:decoration-solid" title={`${records} accepted record${records === 1 ? "" : "s"}: open them`}>
      {text}
    </Link>
  );
  return (
    <tr className="align-top">
      <td className="py-2 pe-3">
        <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name} <span className="text-muted">({r.unit})</span>
        {r.budgetRef && v.spend.byLine[r.budgetRef] && (
          <span className="mt-1 block text-xs text-muted" title="The budget line that pays for this indicator">
            {r.budgetRef}: {num(v.spend.byLine[r.budgetRef].quarter)} spent this quarter · {num(v.spend.byLine[r.budgetRef].actual)} of {num(v.spend.byLine[r.budgetRef].budget)} {v.spend.currency} to date
            {v.spend.byLine[r.budgetRef].budget > 0 && ` (${Math.round((v.spend.byLine[r.budgetRef].actual / v.spend.byLine[r.budgetRef].budget) * 100)}%)`}
          </span>
        )}
      </td>
      <td className="py-2 pe-3 text-end tabular-nums">{num(r.yearTarget)}</td>
      <td className="py-2 pe-3 text-end">{evidence(from, num(r.quarter), r.records.quarter)}</td>
      <td className="py-2 pe-3 text-end">
        {evidence(yearFrom, num(r.year), r.records.year)}
        {r.yearTarget > 0 && <span className="block text-xs text-muted">{Math.round((r.year / r.yearTarget) * 100)}%</span>}
      </td>
      <td className="py-2 pe-3">
        {editing ? (
          <div>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                  {s === r.suggested ? " (suggested)" : ""}
                </option>
              ))}
            </select>
            <textarea className={input} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryBtn}
                onClick={() =>
                  void act({ action: "row", indicator: r.code, status: status === r.suggested ? null : status, comment }, "Saved.")
                    .then(() => setEditing(false))
                    .catch(() => undefined)
                }
              >
                Save
              </button>
              {r.edited && (
                <button type="button" className={quietBtn} onClick={() => void act({ action: "row", indicator: r.code, status: null, comment: null }, "Back to the suggested status and comment.").then(() => setEditing(false)).catch(() => undefined)}>
                  Use suggestion
                </button>
              )}
              <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Pill tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
            {!r.edited && <span className="ms-2 text-xs text-muted">suggested</span>}
            <p className="mt-1">{r.comment}</p>
            {v.mayEdit && (
              <button type="button" className="mt-1 text-xs font-semibold text-forest hover:underline" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function GenderStrip({ rows }: { rows: Row[] }) {
  const people = rows.filter((r) => r.women + r.men > 0);
  const women = people.reduce((t, r) => t + r.women, 0);
  const men = people.reduce((t, r) => t + r.men, 0);
  const wl = rows.reduce((t, r) => t + r.womenLed, 0);
  const ml = rows.reduce((t, r) => t + r.menLed, 0);
  if (!women && !men && !wl && !ml) return <p className="mt-3 text-sm text-muted">No results this quarter record women and men separately.</p>;
  return (
    <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm">
      This quarter: <b>{num(women)}</b> women and <b>{num(men)}</b> men{women + men > 0 && ` (${Math.round((women / (women + men)) * 100)}% women)`}
      {wl + ml > 0 && (
        <>
          {" "}
          · <b>{num(wl)}</b> women-led and <b>{num(ml)}</b> men-led businesses
        </>
      )}
      . Counted from accepted results; people may be counted under more than one indicator.
    </p>
  );
}

function Grm({ v, act }: { v: QprView; act: Act }) {
  const s = (x: number | null) => (x === null ? "" : String(x));
  const [rec, setRec] = useState(s(v.saved.grm.received));
  const [res, setRes] = useState(s(v.saved.grm.resolved));
  useEffect(() => {
    setRec(s(v.saved.grm.received));
    setRes(s(v.saved.grm.resolved));
  }, [v.saved.grm.received, v.saved.grm.resolved]);
  const toN = (x: string) => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x))));
  const dirty = rec !== s(v.saved.grm.received) || res !== s(v.saved.grm.resolved);
  return (
    <div className="mt-6 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        Complaints received this quarter
        <input inputMode="numeric" className={input} value={rec} disabled={!v.mayEdit} onChange={(e) => setRec(e.target.value)} />
      </label>
      <label className="text-sm">
        Resolved
        <input inputMode="numeric" className={input} value={res} disabled={!v.mayEdit} onChange={(e) => setRes(e.target.value)} />
      </label>
      {v.mayEdit && dirty && (
        <button type="button" className={primaryBtn} onClick={() => void act({ action: "grm", received: toN(rec), resolved: toN(res) }, "Saved.").catch(() => undefined)}>
          Save
        </button>
      )}
    </div>
  );
}

function Risks({ v, act }: { v: QprView; act: Act }) {
  const [list, setList] = useState(v.saved.risks);
  useEffect(() => setList(v.saved.risks), [v.saved.risks]);
  const dirty = JSON.stringify(list) !== JSON.stringify(v.saved.risks);
  return (
    <section className="mt-6">
      <h3 className="font-display text-lg">V. Risk Management</h3>
      <div className="mt-2 space-y-2">
        {list.map((r, k) => (
          <div key={k} className="grid gap-2 sm:grid-cols-2">
            <textarea className={input} rows={2} placeholder="Risk" value={r.risk} disabled={!v.mayEdit} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, risk: e.target.value } : x)))} />
            <textarea className={input} rows={2} placeholder="Mitigation measures" value={r.mitigation} disabled={!v.mayEdit} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, mitigation: e.target.value } : x)))} />
          </div>
        ))}
        {!list.length && <p className="text-sm text-muted">No risks listed.</p>}
      </div>
      {v.mayEdit && (
        <div className="mt-2 flex gap-2">
          <button type="button" className={quietBtn} onClick={() => setList([...list, { risk: "", mitigation: "" }])}>
            Add a risk
          </button>
          {dirty && (
            <button type="button" className={primaryBtn} onClick={() => void act({ action: "risks", risks: list }, "Saved.").catch(() => undefined)}>
              Save risks
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Finance's monthly budget-against-actual workbook: checked first, then imported. */
function SpendImport({ v, onDone }: { v: QprView; onDone: () => void }) {
  const { user } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<{ months: string[]; monthLabels: Record<string, string>; lines: { code: string }[]; totals: { costs: { actual: number } | null }; problems: string[]; notes: string[]; sheet: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!v.mayImport) return null;
  const send = async (check: boolean) => {
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      if (link.trim()) body.append("sharepointUrl", link.trim());
      const res = await fetch(`/api/projects/${v.project.code}/actuals${check ? "?check=1" : ""}`, { method: "POST", body, headers: { "x-demo-user": user?.id ?? "" } });
      const out = await res.json().catch(() => ({}));
      if (out.preview) setPreview(out.preview);
      if (!res.ok) throw new Error(out.error ?? (out.preview?.problems?.length ? "The workbook has problems: see below." : `Import failed (${res.status})`));
      if (!check) {
        setFile(null);
        setPreview(null);
        onDone();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mt-3 block rounded-xl bg-sunken p-3 text-sm text-ink">
      <span className="block font-semibold">Import Finance&rsquo;s budget against actual</span>
      <span className="block text-xs text-muted">The FACE workbook sent to UNDP (.xlsx). Only its ICE Report sheet is read; the ledger sheets, which name staff, are not kept.</span>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      <input className={input} placeholder="Link to the workbook in SharePoint (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
      {preview && (
        <span className="mt-2 block text-xs">
          Sheet &ldquo;{preview.sheet}&rdquo;: {preview.lines.length} budget lines, {preview.months.map((m) => preview.monthLabels[m] ?? m).join(", ")}
          {preview.totals.costs && `; ${num(preview.totals.costs.actual)} ${v.spend.currency} spent in all`}.
          {preview.problems.map((p) => (
            <span key={p} className="block text-clay">{p}</span>
          ))}
          {preview.notes.map((p) => (
            <span key={p} className="block text-ochre">{p}</span>
          ))}
        </span>
      )}
      {err && <span role="alert" className="mt-1 block text-xs text-clay">{err}</span>}
      <span className="mt-2 flex gap-2">
        <button type="button" className={quietBtn} disabled={!file || busy} onClick={() => void send(true)}>
          Check it
        </button>
        <button type="button" className={primaryBtn} disabled={!file || busy || !preview || preview.problems.length > 0} onClick={() => void send(false)}>
          Import
        </button>
      </span>
    </span>
  );
}

/** Under each activity: its updates this quarter, the breakdown tables and the photos that go into the report. */
function ActivityExtras({ v, activity }: { v: QprView; activity: string }) {
  const { user } = useSession();
  const codes = v.rows.filter((r) => r.activity === activity).map((r) => r.code);
  const updates = v.updates.filter((u) => u.activity === activity);
  const tables = v.breakdowns.filter((b) => codes.includes(b.indicator));
  const photos = v.photos.filter((p) => p.activity === activity);
  if (!updates.length && !tables.length && !photos.length)
    return (
      <p className="mt-2 text-xs text-muted">
        No activity updates or captioned photos this quarter.{" "}
        <Link href="/progress/results" className="font-semibold text-forest hover:underline">
          Add them on Results
        </Link>
      </p>
    );
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-sunken p-3 text-sm">
      {updates.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Updates this quarter (Claude drafts from these)</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">
            {updates.map((u) => (
              <li key={u.id}>
                <span className="text-muted">{u.date}:</span> {u.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {tables.map((b) => (
        <div key={b.indicator}>
          <p className="text-xs font-semibold">{b.title}</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[420px] text-xs">
              <thead>
                <tr>
                  {b.columns.map((c) => (
                    <th key={c} className="py-1 pe-3 text-start font-semibold text-muted">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.rows.map((r, k) => (
                  <tr key={k} className={r[0] === "Total" ? "font-semibold" : ""}>
                    {r.map((c, j) => (
                      <td key={j} className="py-1 pe-3 tabular-nums">
                        {typeof c === "number" ? num(c) : c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {photos.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Photos in the report ({photos.length})</p>
          <ul className="mt-1 space-y-1">
            {photos.map((ph) => (
              <li key={ph.hash}>
                <button type="button" className="text-start font-semibold text-forest hover:underline" onClick={() => void openReceipt(ph.hash, user?.id)}>
                  {ph.caption}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Acronyms({ v, act }: { v: QprView; act: Act }) {
  const toText = (l: [string, string][] | undefined) => (l ?? []).map(([a, b]) => `${a}: ${b}`).join("\n");
  const [text, setText] = useState(toText(v.saved.acronyms));
  useEffect(() => setText(toText(v.saved.acronyms)), [v.saved.acronyms]);
  const dirty = text !== toText(v.saved.acronyms);
  const parse = (): [string, string][] =>
    text
      .split("\n")
      .map((l) => l.split(":"))
      .filter((x) => x.length >= 2 && x[0].trim() && x.slice(1).join(":").trim())
      .map((x) => [x[0].trim(), x.slice(1).join(":").trim()]);
  return (
    <details className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer font-display text-lg">Acronyms ({v.saved.acronyms?.length ?? 0})</summary>
      <p className="mt-1 text-xs text-muted">One per line, as &ldquo;IWRM: Integrated Water Resources Management&rdquo;. Kept from quarter to quarter. The Word file also gets a table of contents.</p>
      <textarea className={input} rows={8} value={text} disabled={!v.mayEdit} onChange={(e) => setText(e.target.value)} />
      {v.mayEdit && dirty && (
        <button type="button" className={`${primaryBtn} mt-2`} onClick={() => void act({ action: "acronyms", acronyms: parse() }, "Saved.").catch(() => undefined)}>
          Save acronyms
        </button>
      )}
    </details>
  );
}
