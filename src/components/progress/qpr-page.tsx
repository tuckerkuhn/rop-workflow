"use client";

import { plainError } from "@/lib/plain-error";
import { askConfirm } from "@/components/app/dialogs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { openReceipt } from "@/components/people/expense-page";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn, StatusPill } from "@/components/workspace/ui";
import { OverspendReasonPicker } from "@/components/progress/overspend-reason";
import { SECTIONS, STATUSES, STATUS_LABEL, cannotOnReport, durationOf, overspentLines, quarterSpendOf, type QprPatch, type Row, type Status } from "@/lib/qpr";
import { qprDocx, type Images } from "@/lib/qpr-docx";
import { formatMinutes } from "@/lib/report-copy";
import { ShareLinks } from "@/components/progress/share-links";
import { ClaimCheckPanel } from "@/components/progress/claim-check";
import { ReportDownloads } from "@/components/progress/downloads";
import { SpendImport } from "@/components/progress/spend-import";
import { askForChecks, beforeDownload, PreflightButton, usePreflight } from "@/components/progress/preflight-page";
import { ReportChecks, ReportKinds } from "@/components/progress/report-checks";
import { MoneySourceLink, ProofNumber } from "@/components/progress/proof-panel";
import { useT } from "@/components/app/i18n";
import { personName } from "@/lib/project";
import { ErrorNote } from "@/components/app/error-note";
import { quarterOf, quarterRange } from "@/lib/results";
import { lastEndedQuarter, useReportQuarter } from "@/components/progress/use-report-quarter";
import type { QprView } from "@/app/api/projects/[code]/qpr/route";

/**
 * The donor's quarterly progress report, in ROP's UNDP layout. Figures come from accepted
 * results and open the records behind them; the team writes the text (Claude can draft it);
 * checks list what to fix before the report goes out; it downloads as a Word document.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const TONE: Record<Status, "forest" | "sky" | "ochre" | "clay" | "muted"> = { completed: "forest", on_track: "sky", delayed: "clay", not_implemented: "clay", not_started: "muted" };

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
const lastEnded = () => lastEndedQuarter();

export function QprPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const router = useRouter();
  const asked = /^\d{4}-Q[1-4]$/.test(params.get("q") ?? "") ? params.get("q")! : null;
  // The quarter Home and pre-flight call "the next report" (server/next-report): the page opens on it.
  const nextQ = useReportQuarter(project.id, user?.id, ready && project.saved);
  const quarter = asked ?? nextQ ?? lastEnded();
  const [v, setV] = useState<QprView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const copyAt = params.get("copy");
  const url = `/api/projects/${project.id}/qpr?q=${quarter}${copyAt ? `&copy=${encodeURIComponent(copyAt)}` : ""}`;
  const { t } = useT();
  // Pre-flight: refreshed every time the report changes, so the count on the buttons is current.
  const pf = usePreflight(project.id, user?.id, { kind: "qpr", quarter }, v);
  const blocking = pf && !pf.released ? pf.items.filter((i) => i.group === "blocks").length : 0;
  const worthFixing = pf && !pf.released ? pf.items.filter((i) => i.group === "fix").length : 0;

  useEffect(() => {
    if (nextQ && !asked) router.replace(`/progress/report?q=${nextQ}${window.location.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextQ]);

  const load = useCallback(async () => {
    // Wait for the quarter to open on, so the page does not show one quarter and then another.
    if (!user || (!asked && project.saved)) return;
    try {
      setV(await call<QprView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url, asked, project.saved]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);

  // A link from pre-flight or Home names the part to fix (#sec-summary, #claims, #info, #overspend): go there once the report is on screen.
  const shown = !!v;
  useEffect(() => {
    if (!shown || !window.location.hash) return;
    // The part's id is used as written: every id on this page is plain letters, digits, dots and dashes.
    const go = () => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
    go();
    // Once more after the panels above it have loaded and pushed it down.
    const again = window.setTimeout(go, 900);
    return () => window.clearTimeout(again);
  }, [shown]);

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
    if (!v || !user) return;
    // A copy (released or preview) is downloaded as it was; the live draft goes through pre-flight first.
    const draft = v.frozen ? 0 : await beforeDownload(project.id, user.id, pf, (n) => t("pf.draftConfirm", { n }), { kind: "qpr", quarter }, t("pf.uncheckedConfirm"));
    if (draft === null) return;
    setBusy("download");
    setError("");
    try {
      const blob = await qprDocx({ ...v, origin: window.location.origin, draft }, await loadImages(v.photos));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${v.project.code}-QPR-${v.quarter}${v.frozen?.kind === "practice" ? `-practice-${v.frozen.at.slice(0, 10)}` : ""}${draft ? "-DRAFT-not-checked" : ""}.docx`;
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
  // One count everywhere: the Report check's (it includes every "stop" of the report's own checks, and more).
  // Until the check has loaded, the report's own checks stand in.
  const blockN = pf ? blocking : stops.length;
  const fixN = pf ? worthFixing : (v?.checks.length ?? 0) - stops.length;
  const cannot = v ? cannotOnReport({ edit: v.mayEdit, accept: user.project.includes("mel-owner"), import: v.mayImport, release: v.mayRelease }) : [];
  const { from, to } = quarterRange(quarter);
  // Home's "Next report" (the quarter just ended while its report is still due, else the one under way).
  const nowQ = nextQ ?? quarterOf(new Date().toISOString().slice(0, 10));
  const underWay = quarter === quarterOf(new Date().toISOString().slice(0, 10));
  const qLabel = (q: string) => q.replace("-", " ");

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <ReportKinds kind="qpr" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-warn">{project.name}</p>
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
          {from} to {to}. Figures come from results that monitoring, evaluation and learning (MEL) has accepted, and each one opens the records and proof behind it. Write or draft the text, fix what the checks list, then download it for Word.
        </p>
        <ReportChecks p={pf} />
        <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm font-semibold">
          {quarter === nowQ ? (
            underWay ? t("rp.quarterNow", { q: qLabel(quarter), to }) : t("rp.quarterDue", { q: qLabel(quarter), from, to })
          ) : (
            <>
              {t("rp.quarterPast", { q: qLabel(quarter), from, to, now: qLabel(nowQ) })}{" "}
              <Link href={`/progress/report?q=${nowQ}`} className="text-forest underline">
                {t("rp.openQuarter", { q: qLabel(nowQ) })}
              </Link>
            </>
          )}
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
        {error && <ErrorNote>{error}</ErrorNote>}
        {project.saved && !v && !error && <p className="mt-10 text-center text-sm text-muted">{t("report.loading")}</p>}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && (
          <>
            <div className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
              <Pill tone="muted">{qLabel(quarter)}</Pill>
              {v.frozen?.kind === "practice" ? (
                <Pill tone="sky">Preview copy · {v.frozen.at.slice(0, 16).replace("T", " ")} UTC · {v.frozen.by}</Pill>
              ) : v.saved.released ? (
                <Pill tone="forest">Released {v.saved.released.at.slice(0, 10)} by {personName(v.saved.released.by)}</Pill>
              ) : (
                <Pill tone={blockN ? "clay" : "ochre"}>
                  Draft · {blockN} blocking · {fixN} worth fixing
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
              {!v.frozen && <PreflightButton p={pf} report={{ kind: "qpr", quarter }} className={quietBtn} />}
              <button type="button" className={quietBtn} disabled={busy === "download"} onClick={() => void download()}>
                {busy === "download" ? "Making the Word file…" : "Download for Word"}
              </button>
              {v.mayPractice && (
                <button
                  type="button"
                  className={quietBtn}
                  disabled={!!busy}
                  title="Saves a copy as if released, without locking anything, so you can see what would go out and compare it later."
                  onClick={() => quiet(act({ action: "practice" }, "Preview copy saved. Nothing is locked or released (a share link made before release shows it): go back to the report to keep working."))}
                >
                  Save a preview copy
                </button>
              )}
              {v.mayRelease && (
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={!!busy || stops.length > 0 || blockN > 0}
                  onClick={() =>
                    void askConfirm({
                      message: `Mark the ${qLabel(quarter)} report final and release it to the donor? It is locked for good: this copy is what the donor receives. It appears in the donor's Reports tab, and every share link for this quarter opens it from now on. No email is sent: tell the donor yourself. To see what would go out first, use "Save a preview copy" instead.`,
                      confirm: "Mark final and release",
                    }).then((ok) => (ok ? quiet(act({ action: "release" }, "Released: the report is final, it is in the donor's Reports tab, and it can no longer be changed.")) : undefined))
                  }
                >
                  Mark final and release to the donor{blockN ? ` (${blockN} blocking)` : ""}
                </button>
              )}
              {/* Why it cannot be marked final, in the page: a hover title never shows on a phone. */}
              {v.mayRelease && blockN > 0 && (
                <p className="basis-full text-sm text-clay">
                  {blockN === 1 ? t("report.blockedOne") : t("report.blocked", { n: blockN })}{" "}
                  <a href="#checks" onClick={askForChecks} className="font-semibold underline">
                    {t("pf.button")}
                  </a>
                </p>
              )}
            </div>

            {/* What this person's roles do not allow on this report, said once, before they start. */}
            {!v.frozen && !v.saved.released && cannot.length > 0 && (
              <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-semibold">{t("rp.cannot")}</p>
                <ul className="mt-1 list-disc ps-5">
                  {cannot.map((k) => (
                    <li key={k}>{t(`rp.cannot.${k}`)}</li>
                  ))}
                </ul>
                <p className="mt-1 text-muted">{t("rp.cannot.ask")}</p>
              </div>
            )}
            {v.frozen && (
              <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-semibold">
                  {v.frozen.kind === "release"
                    ? `This is the report as released on ${v.frozen.at.slice(0, 10)}: what the donor received. It stays as it was.`
                    : "This is a preview copy: the report as it would have gone out at that moment. Nothing was locked or released."}
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
            {v.photosHeld > 0 && (
              <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm">
                {v.photosHeld} captioned {v.photosHeld === 1 ? "photo is" : "photos are"} held back from the report until checked for people who can be recognised, or until consent covers them.{" "}
                <Link href="/progress/photos" className="font-semibold text-forest hover:underline">
                  Photos and posts
                </Link>
              </p>
            )}
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
                      <span className={c.level === "stop" ? "font-semibold text-clay" : "text-warn"}>{c.level === "stop" ? "Fix" : "Check"}</span>
                      <span>{c.key ? t(c.key, c.vars) : c.text}</span>
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
              <h2 className="border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight">II. Progress Towards Results</h2>
              <IndicatorTable v={v} act={act} />
            </section>

            <section className="mt-8">
              <h2 className="border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight">Narrative Description</h2>
              {v.activities.map((a) => (
                <div key={a.code}>
                  <Section v={v} k={`act.${a.code}`} heading={`Activity ${a.code}: ${a.name}`} act={act} busy={busy} draftable />
                  <ActivityExtras v={v} activity={a.code} />
                </div>
              ))}
            </section>

            <section className="mt-8">
              <h2 className="border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight">III. Cross-cutting Issues</h2>
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

            {/* Everything for sending the report out, in one place at the end, closed until wanted. */}
            <Collapsible ids={["send", "claims", "share"]} className="mt-10 rounded-2xl border border-line bg-surface px-4 py-3" summary={<span className="font-ledger text-lg font-bold">Send and share</span>} hint="Downloads for the donor and the auditor, the check of the text against the records, preview copies and share links.">
              <div id="send" className="scroll-mt-24" />
            {!v.frozen && v.copies.some((c) => c.kind === "practice") && (
              <p className="mt-3 text-sm text-muted">
                Preview copies:{" "}
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

            <ReportDownloads project={project.id} quarter={quarter} user={user.id} mayEvidence={!!user.admin || user.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r))} mayAudit={!!user.admin || user.project.includes("mel-owner")} />
            <div id="claims" className="scroll-mt-24" />
            <ClaimCheckPanel
              check={v.saved.claimCheck}
              sections={Object.fromEntries(Object.entries(v.saved.sections).map(([k, t]) => [k, t?.text ?? ""]))}
              headings={Object.fromEntries([...SECTIONS.map((x) => [x.key, x.heading]), ...v.activities.map((x) => [`act.${x.code}`, `Activity ${x.code}`])])}
              busy={busy === "check-claims"}
              mayRun={v.mayEdit}
              onRun={() => quiet(act({ action: "check-claims" }, "Checked. Look at each finding against its records; nothing has been changed."))}
              onDecide={(index, choice) => {
                const section = v.saved.claimCheck?.issues[index]?.section;
                void quiet(
                  act({ action: "claim-decide", index, choice }, choice === "fix" ? t("ha.claimFix") : choice === "keep" ? t("ha.claimKeep") : t("ha.claimUndo")).then(() => {
                    // "Fix the text" takes the person straight to the section the sentence is in.
                    if (choice === "fix" && section) document.getElementById(`sec-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }),
                );
              }}
            />
            <div id="share" className="scroll-mt-24" />
            {!v.frozen?.kind || v.frozen.kind === "release" ? <ShareLinks project={project.id} quarter={quarter} user={user.id} ready={v.copies.length > 0} /> : null}

            </Collapsible>
          </>
        )}
      </main>
    </div>
  );
}

type Act = (a: QprPatch, msg: string) => Promise<void>;

function InfoBox({ v, act, onImported }: { v: QprView; act: Act; onImported: () => void }) {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const to = quarterRange(v.quarter).to;
  const [f, setF] = useState(v.saved.info);
  const [spend, setSpend] = useState(v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  useEffect(() => {
    setF(v.saved.info);
    setSpend(v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  }, [v.saved.info, v.saved.quarterSpend]);
  const c = v.spend.currency;
  const { t } = useT();
  // What the Word file prints when the field is left empty (lib/qpr durationOf).
  const fromDates = durationOf(undefined, v.project);
  const dirty = JSON.stringify(f) !== JSON.stringify(v.saved.info) || spend !== (v.saved.quarterSpend === null ? "" : String(v.saved.quarterSpend));
  const field = (k: keyof typeof f, label: string, wide = false) => (
    <label className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input className={input} value={f[k] ?? ""} disabled={!v.mayEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <Collapsible ids={["info", "overspend"]} id="info" className="mt-6 scroll-mt-24 rounded-2xl border border-line bg-surface p-4" summary={<SectionLabel>Project information and spending</SectionLabel>} hint="Title, agreement, budget, this quarter's spending and its import. Carried forward from last quarter.">
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
          <dd>
            <MoneySourceLink project={project.id} user={user?.id ?? ""} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Spent this quarter</dt>
          <dd className="font-semibold tabular-nums">{quarterSpendOf(v.saved, v.spend) === null ? "—" : `${num(quarterSpendOf(v.saved, v.spend)!)} ${c}`}</dd>
          {v.saved.quarterSpend !== null && v.spend.quarter !== null && <dd className="text-xs text-warn">Typed in; the import says {num(v.spend.quarter)}</dd>}
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">{t("rp.totals.onReport")}</p>
      <p className="mt-2 text-xs text-muted">
        {v.spend.source.kind === "import" ? (
          <>
            {t("pw.fromBva")}{" "}
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
        {v.mayImport && <SpendImport code={v.project.code} currency={v.spend.currency} onDone={onImported} />}
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
        <div>
          {field("duration", "Project duration, as in the agreement (e.g. 1 March 2025 – 30 June 2027)")}
          {!f.duration?.trim() && fromDates && <p className="mt-1 text-xs text-muted">{t("rp.durationFromDates", { dates: fromDates })}</p>}
        </div>
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
    </Collapsible>
  );
}

/** One reason per budget line spent above its budget, kept on the line; it goes in the report under the project information. */
function Overspend({ v, act }: { v: QprView; act: Act }) {
  const { t } = useT();
  const lines = overspentLines(v.spend, v.saved);
  if (!lines.length) return null;
  return (
    <div id="overspend" className="mt-3 scroll-mt-24 space-y-3 rounded-xl bg-paper p-3">
      <p className="text-sm font-semibold">Budget lines above budget</p>
      {lines.map((l) => (
        <div key={l.code} className="text-sm">
          {t("os.line", { code: l.code, spent: num(l.actual), budget: num(l.budget), currency: v.spend.currency, pct: l.pct })}
          <OverspendReasonPicker saved={{ reason: l.reason, note: l.note, text: l.explanation }} mayWrite={v.mayEdit && !v.saved.released} onSave={(r) => act({ action: "overspend", line: l.code, ...r }, "Saved.")} />
        </div>
      ))}
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
    <section className="mt-6 scroll-mt-24" id={`sec-${k}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-lg font-semibold">{heading ?? def?.heading}</h3>
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
                onClick={async () => {
                  if (text.trim() && !(await askConfirm({ message: "Replace this text with a new draft?", confirm: "Replace with a draft" }))) return;
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
  const { t } = useT();
  return (
    <>
      {/* Below a wide screen: one block per target, stacked, so nothing scrolls sideways on a phone. */}
      <div className="mt-3 space-y-4 lg:hidden">
        {outputs.map((o) => (
          <div key={o}>
            <p className="rounded-lg bg-sunken px-2 py-2 text-sm font-semibold">{o}</p>
            <div className="divide-y divide-line">
              {v.rows
                .filter((r) => r.output === o)
                .map((r) => (
                  <IndicatorRow key={r.code} r={r} v={v} act={act} card />
                ))}
            </div>
          </div>
        ))}
      </div>
    <div className="mt-3 hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-start text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pe-3 text-start">Output indicator</th>
            <th className="py-2 pe-3 text-end">{t("rp.col.target", { year })}</th>
            <th className="py-2 pe-3 text-end">{t("rp.col.quarter", { q: qn })}</th>
            <th className="py-2 pe-3 text-end">{t("rp.col.year")}</th>
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
    </>
  );
}

/** One target of the report: a table row on a wide screen, a stacked block (`card`) below that. */
function IndicatorRow({ r, v, act, card }: { r: Row; v: QprView; act: Act; card?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>(r.status);
  const [comment, setComment] = useState(r.comment);
  useEffect(() => {
    setStatus(r.status);
    setComment(r.comment);
  }, [r.status, r.comment]);
  const { from, to } = quarterRange(v.quarter);
  const yearFrom = `${v.quarter.slice(0, 4)}-01-01`;
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  // One tap opens the accepted results behind the figure and their proof (lib/evidence).
  const evidence = (f: string, value: number, records: number, proof?: number) => (
    <ProofNumber project={project.id} user={user?.id ?? ""} indicator={r.code} from={f} to={to} value={value} records={records} proof={proof}>
      {num(value)}
    </ProofNumber>
  );
  const { t } = useT();
  const name = (
    <>
        <span className="font-mono text-xs text-muted">{r.donorCode}</span> {r.name} <span className="text-muted">({r.unit})</span>
        {r.budgetRef && v.spend.byLine[r.budgetRef] && (
          <span className="mt-1 block text-xs text-muted" title={t("pw.paysFor")}>
            {r.budgetRef}: {num(v.spend.byLine[r.budgetRef].quarter)} spent this quarter · {num(v.spend.byLine[r.budgetRef].actual)} of {num(v.spend.byLine[r.budgetRef].budget)} {v.spend.currency} to date
            {v.spend.byLine[r.budgetRef].budget > 0 && ` (${Math.round((v.spend.byLine[r.budgetRef].actual / v.spend.byLine[r.budgetRef].budget) * 100)}%)`}
          </span>
        )}
    </>
  );
  const yearCell = (
    <>
        {evidence(yearFrom, r.year, r.records.year)}
        {r.yearTarget > 0 && <span className="block text-xs text-muted">{Math.round((r.year / r.yearTarget) * 100)}%</span>}
    </>
  );
  const statusCell = (
    <>
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
            <StatusPill tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
            {!r.edited && <span className="ms-2 text-xs text-muted">suggested</span>}
            <p className="mt-1">{r.comment}</p>
            {v.mayEdit && (
              <button type="button" className="mt-1 text-xs font-semibold text-forest hover:underline" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
        )}
    </>
  );
  const head = "text-xs uppercase tracking-wide text-muted";
  if (card)
    return (
      <div className="py-3 text-sm">
        <p>{name}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <dt className={head}>{t("rp.col.target", { year: v.quarter.slice(0, 4) })}</dt>
            <dd className="tabular-nums">{num(r.yearTarget)}</dd>
          </div>
          <div>
            <dt className={head}>{t("rp.col.quarter", { q: v.quarter.slice(5) })}</dt>
            <dd>{evidence(from, r.quarter, r.records.quarter, r.records.files)}</dd>
          </div>
          <div>
            <dt className={head}>{t("rp.col.year")}</dt>
            <dd>{yearCell}</dd>
          </div>
        </dl>
        <div className="mt-2">{statusCell}</div>
      </div>
    );
  return (
    <tr className="align-top">
      <td className="py-2 pe-3">{name}</td>
      <td className="py-2 pe-3 text-end tabular-nums">{num(r.yearTarget)}</td>
      <td className="py-2 pe-3 text-end">{evidence(from, r.quarter, r.records.quarter, r.records.files)}</td>
      <td className="py-2 pe-3 text-end">{yearCell}</td>
      <td className="py-2 pe-3">{statusCell}</td>
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

/**
 * Complaints and feedback for the quarter: counted from the feedback log, so nobody counts them a
 * second time by hand. Figures typed here replace the log's count on the report, like spending.
 */
function Grm({ v, act }: { v: QprView; act: Act }) {
  const s = (x: number | null) => (x === null ? "" : String(x));
  const [rec, setRec] = useState(s(v.saved.grm.received));
  const [res, setRes] = useState(s(v.saved.grm.resolved));
  const [typing, setTyping] = useState(v.saved.grm.received !== null);
  useEffect(() => {
    setRec(s(v.saved.grm.received));
    setRes(s(v.saved.grm.resolved));
    if (v.saved.grm.received !== null) setTyping(true);
  }, [v.saved.grm.received, v.saved.grm.resolved]);
  const toN = (x: string) => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x))));
  const dirty = rec !== s(v.saved.grm.received) || res !== s(v.saved.grm.resolved);
  const log = v.grmLog;
  const typed = v.saved.grm.received !== null;
  return (
    <div className="mt-6 text-sm">
      <p>
        {log ? (
          <>
            From the feedback log: <b>{log.answered + log.open}</b> needing an answer, <b>{log.answered}</b> answered{log.open ? `, ${log.open} still open` : ""}
            {log.thanks ? `; plus ${log.thanks} thank-you ${log.thanks === 1 ? "note" : "notes"}` : ""}.
          </>
        ) : (
          <>The feedback log has no count for this quarter: nothing is recorded yet, or the log was started after the quarter ended. Type the figures below.</>
        )}{" "}
        <Link href="/progress/feedback" className="font-semibold text-forest hover:underline">
          Open the log
        </Link>
      </p>
      {typed && log && <p className="mt-1 text-xs text-warn">The report uses the figures typed below instead of the log&rsquo;s count.</p>}
      {v.mayEdit && !typing && (
        <button type="button" className="mt-1 text-xs font-semibold text-forest hover:underline" onClick={() => setTyping(true)}>
          Type different figures instead
        </button>
      )}
      {typing && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Complaints received this quarter
            <input inputMode="numeric" className={input} value={rec} placeholder={log ? `${log.answered + log.open} from the log` : ""} disabled={!v.mayEdit} onChange={(e) => setRec(e.target.value)} />
          </label>
          <label className="text-sm">
            Resolved
            <input inputMode="numeric" className={input} value={res} placeholder={log ? `${log.answered} from the log` : ""} disabled={!v.mayEdit} onChange={(e) => setRes(e.target.value)} />
          </label>
          {v.mayEdit && dirty && (
            <button type="button" className={primaryBtn} onClick={() => void act({ action: "grm", received: toN(rec), resolved: toN(res) }, "Saved.").catch(() => undefined)}>
              Save
            </button>
          )}
          {v.mayEdit && typed && log && (
            <button type="button" className={quietBtn} onClick={() => void act({ action: "grm", received: null, resolved: null }, "Back to the feedback log's count.").catch(() => undefined)}>
              Use the log&rsquo;s count
            </button>
          )}
        </div>
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
      <h3 className="text-lg font-semibold">V. Risk Management</h3>
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
      <summary className="cursor-pointer text-lg font-semibold">Acronyms ({v.saved.acronyms?.length ?? 0})</summary>
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

/**
 * A part of the report closed by default. It opens when a link names it or something inside it
 * (#info, #claims…), so a link from the report check or Home still lands on the right place.
 */
function Collapsible({ ids, id, className, summary, hint, children }: { ids: string[]; id?: string; className: string; summary: React.ReactNode; hint?: string; children: React.ReactNode }) {
  const named = () => typeof window !== "undefined" && ids.includes(window.location.hash.slice(1));
  const [open, setOpen] = useState(named);
  useEffect(() => {
    const go = () => named() && setOpen(true);
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <details id={id} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={className}>
      <summary className="cursor-pointer">
        {summary}
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </summary>
      {children}
    </details>
  );
}
