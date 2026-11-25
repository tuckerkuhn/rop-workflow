"use client";

import { plainError } from "@/lib/plain-error";
import { longDate } from "@/lib/weekly";
import { askConfirm } from "@/components/app/dialogs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { openReceipt } from "@/components/people/expense-page";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import { OverspendReasonPicker } from "@/components/progress/overspend-reason";
import { activityHeading, SECTIONS, STATUSES, STATUS_LABEL, cannotOnReport, checkHref, durationOf, overspentLines, quarterSpendOf, type QprPatch, type Row, type Status } from "@/lib/qpr";
// The Word builder (and the `docx` library) loads on the Download click, not with the page.
import type { Images } from "@/lib/qpr-docx";
import { targetStatus, wordOfStatus } from "@/lib/target-status";
import { formatMinutes } from "@/lib/report-copy";
import { ShareLinks } from "@/components/progress/share-links";
import { ClaimCheckPanel } from "@/components/progress/claim-check";
import { ReportDownloads } from "@/components/progress/downloads";
import { SpendImport } from "@/components/progress/spend-import";
import { askForChecks, beforeDownload, itemText, OPEN_CHECKS, PreflightButton, usePreflightState } from "@/components/progress/preflight-page";
import { ReportChecks, ReportKinds } from "@/components/progress/report-checks";
import { FormatAskedFor } from "@/components/progress/format-asked-for";
import { MoneySourceLink, ProofNumber } from "@/components/progress/proof-panel";
import { useT } from "@/components/app/i18n";
import { personName } from "@/lib/project";
import { ErrorNote } from "@/components/app/error-note";
import { quarterOf, quarterRange } from "@/lib/results";
import { lastEndedQuarter, useReportQuarter } from "@/components/progress/use-report-quarter";
import { lessonForReport } from "@/lib/learning";
import type { QprView } from "@/app/api/projects/[code]/qpr/route";

/**
 * The donor's quarterly progress report, in ROP's UNDP layout. Figures come from accepted
 * results and open the records behind them; the team writes the text (Claude can draft it);
 * the one Report check lists what to fix before the report goes out; it downloads as a Word document.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2 text-base";
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

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

/** The quarter's short name: "Q4" on the calendar's months, else the agreement's months ("Feb to Apr 2026"). */
const shortOf = (v: QprView) => (v.period.calendar ? v.quarter.slice(5) : v.period.label);

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
  // `pfFresh` only once it was read after the latest change; `pfFailed` when it could not be read.
  const { p: pf, fresh: pfFresh, failed: pfFailed } = usePreflightState(project.id, user?.id, { kind: "qpr", quarter }, v);
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
      const { qprDocx } = await import("@/lib/qpr-docx");
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
  // One list, one count: the Report check holds every one of the report's own checks (server/preflight).
  // Until it has loaded, the report's own checks stand in, so release is never offered too early.
  // Right after an edit the last check read may not hold a stop the edit added: the report's own count shows until it is re-read.
  const stops = v?.checks.filter((c) => c.level === "stop").length ?? 0;
  // The Report check lists several of those stops as one row (results waiting, by target). Once it is read
  // and names a blocker, its count is the one shown, so the page gives one number and not two.
  const blockN = pf ? (pfFresh && blocking > 0 ? blocking : Math.max(blocking, stops)) : stops;
  // Mark final only when both say nothing blocks, and the check was read after the latest change.
  const mayMarkFinal = pfFresh && blockN === 0;
  const fixN = pf ? worthFixing : (v?.checks.length ?? 0) - stops;
  const cannot = v ? cannotOnReport({ edit: v.mayEdit, accept: user.project.includes("mel-owner"), import: v.mayImport, release: v.mayRelease }) : [];
  // The days the report counts: the calendar quarter, or the agreement's own period (lib/obligations qprPeriod).
  const period = v && v.quarter === quarter ? v.period : null;
  const { from, to } = period ?? quarterRange(quarter);
  // Home's "Next report" (the quarter just ended while its report is still due, else the one under way).
  const nowQ = nextQ ?? quarterOf(new Date().toISOString().slice(0, 10));
  const realToday = new Date().toISOString().slice(0, 10);
  const underWay = period ? from <= realToday && realToday <= to : quarter === quarterOf(realToday);
  // A quarter key reads as "2026 Q4"; an agreement period that is not a calendar quarter by its months.
  const qLabel = (q: string) => v?.periods?.find((p) => p.quarter === q)?.label ?? (period && q === quarter && !period.calendar ? period.label : q.replace("-", " "));

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <ReportKinds kind="qpr" />
        <div className="mt-5">
          <PageHead
            kicker={project.name}
            title="Quarterly progress report"
            actions={
              <label className="text-sm">
                <span className="font-mono text-xs text-muted">Quarter</span>
                <select className={`${input} font-mono`} value={quarter} onChange={(e) => router.replace(`/progress/report?q=${e.target.value}`)}>
                  {v?.periods
                    ? v.periods.map((p) => (
                        <option key={p.quarter} value={p.quarter}>
                          {p.label}
                        </option>
                      ))
                    : quartersFor(v?.project.start ?? null).map((q) => <option key={q}>{q}</option>)}
                </select>
              </label>
            }
          >
            <span className="font-mono text-xs text-ink">
              {period?.name && `${period.name}${period.number ? `, agreement period ${period.number}` : ""}: `}
              {longDate(from)} to {longDate(to)}.
            </span>{" "}
            Figures come from results that monitoring, evaluation and learning (MEL) has accepted, and each one opens the records and proof behind it. Write or draft the text, fix what the checks list, then download it for Word.
            <span className="mt-2 flex flex-wrap gap-x-4">
              <Link href="/progress/results" className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                Results and proof
              </Link>
              <Link href="/progress" className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                Progress
              </Link>
            </span>
          </PageHead>
        </div>
        <FormatAskedFor frequencies={["quarterly"]} />
        <ReportChecks p={pf} />
        {pfFailed && v && !v.frozen && !v.saved.released && <OwnChecks checks={v.checks} quarter={quarter} />}
        <p className="mt-3 bg-sunken px-4 py-3 text-sm font-semibold">
          {quarter === nowQ ? (
            underWay ? t("rp.quarterNow", { q: qLabel(quarter), to: longDate(to) }) : t("rp.quarterDue", { q: qLabel(quarter), from: longDate(from), to: longDate(to) })
          ) : (
            <>
              {t("rp.quarterPast", { q: qLabel(quarter), from, to, now: qLabel(nowQ) })}{" "}
              <Link href={`/progress/report?q=${nowQ}`} className="text-forest underline">
                {t("rp.openQuarter", { q: qLabel(nowQ) })}
              </Link>
            </>
          )}
        </p>
        {!project.saved && <Empty className="mt-6">Choose a project saved in the database (for example ACRP).</Empty>}
        {error && <ErrorNote>{error}</ErrorNote>}
        {project.saved && !v && !error && <p className="mt-10 text-center text-sm text-muted">{t("report.loading")}</p>}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && (
          <>
            <div className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-ink bg-paper/95 px-4 py-3 font-ledger backdrop-blur sm:-mx-6 sm:px-6">
              <Fig className="font-bold">{qLabel(quarter)}</Fig>
              {v.frozen?.kind === "practice" ? (
                <StatusBlock tone="sky">Preview copy · {v.frozen.at.slice(0, 16).replace("T", " ")} UTC · {v.frozen.by}</StatusBlock>
              ) : v.saved.released ? (
                <StatusBlock tone="forest">Released {longDate(v.saved.released.at)} by {personName(v.saved.released.by)}</StatusBlock>
              ) : (
                <StatusBlock tone={blockN ? "clay" : "ochre"}>
                  Draft · {blockN} blocking · {fixN} worth fixing
                </StatusBlock>
              )}
              {v.work.sittings > 0 && (
                <span className="font-mono text-xs text-muted" title="Edits less than 30 minutes apart count as one sitting, from its first edit to its last, plus 5 minutes.">
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
                  disabled={!!busy || !mayMarkFinal}
                  title={!blockN && !pfFresh ? (pfFailed ? t("pf.notLoaded") : t("pf.rechecking")) : undefined}
                  onClick={() =>
                    void askConfirm({
                      message: `Mark the ${qLabel(quarter)} report final and release it to the donor? ${underWay ? `This period has not ended: it ends on ${longDate(to)}. A result accepted after today will not be in the report the donor receives. ` : ""}It is locked for good: this copy is what the donor receives. It appears in the donor's Reports tab, and every share link for this quarter opens it from now on. No email is sent: tell the donor yourself. To see what would go out first, use "Save a preview copy" instead.`,
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
              <div className="mt-3 border-y border-line px-3 py-3 text-sm">
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
              <section className="mt-4 border-y border-ink px-3 py-3 text-sm">
                <p className="font-semibold">
                  {v.frozen.kind === "release"
                    ? `This is the report as released on ${longDate(v.frozen.at)}: what the donor received. It stays as it was.`
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
                  <Link href={`/progress/report?q=${quarter}`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                    ← Back to the report
                  </Link>
                )}
              </section>
            )}
            {v.photosHeld > 0 && (
              <p className="mt-3 bg-mist px-4 py-3 text-sm">
                {v.photosHeld} captioned {v.photosHeld === 1 ? "photo is" : "photos are"} held back from the report until checked for people who can be recognised, or until consent covers them.{" "}
                <Link href="/progress/photos" className="font-semibold text-forest hover:underline">
                  Photos and posts
                </Link>
              </p>
            )}
            {questions.length > 0 && (
              <section className="mt-4 border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm">
                <p className="font-semibold">Claude needs these facts (placeholders are in [brackets] in the drafts):</p>
                <ul className="mt-1 list-disc ps-5">
                  {questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </section>
            )}

            <InfoBox v={v} act={act} onImported={() => void load()} />
            <Acronyms v={v} act={act} />
            <Section v={v} k="summary" act={act} busy={busy} />
            <Section v={v} k="background" act={act} busy={busy} />

            <section id="targets" className="mt-10 scroll-mt-24">
              <SectionHead className="mt-0">II. Progress Towards Results</SectionHead>
              <IndicatorTable v={v} act={act} />
            </section>

            <section className="mt-10">
              <SectionHead className="mt-0">Narrative Description</SectionHead>
              {v.activities.map((a) => (
                <div key={a.code}>
                  <Section v={v} k={`act.${a.code}`} heading={activityHeading(a)} act={act} busy={busy} draftable />
                  <ActivityExtras v={v} activity={a.code} />
                </div>
              ))}
            </section>

            <section className="mt-10">
              <SectionHead className="mt-0">III. Cross-cutting Issues</SectionHead>
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
            <Collapsible ids={["send", "claims", "share"]} className="mt-12 border-t-2 border-ink pt-3" summary={<SectionHead className="mt-0">Send and share</SectionHead>} hint="Downloads for the donor and the auditor, the check of the text against the records, preview copies and share links.">
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
                      <Link href={`/progress/report?q=${quarter}&copy=${encodeURIComponent(c.at)}`} className="font-mono text-xs hover:text-ink hover:underline">
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
  const to = v.period.to;
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
    <Collapsible ids={["info", "overspend"]} id="info" className="mt-8 scroll-mt-24 border-t-2 border-ink pt-3" summary={<SectionHead className="mt-0">Project information and spending</SectionHead>} hint="Title, agreement, budget, this quarter's spending and its import. Carried forward from last quarter.">
      {/* The note under each figure is set back to plain type: Figures sets its value in large mono. */}
      <Figures
        className="mt-3"
        items={[
          {
            label: "Total budget",
            value: (
              <>
                {num(v.spend.budget)} {c}
                <span className="block font-ledger text-xs font-normal text-muted">{v.spend.withOverhead ? "Whole agreement, overhead included" : "Overhead not included"}</span>
              </>
            ),
          },
          {
            label: `Cumulative to ${to}`,
            value: (
              <>
                {num(v.spend.cumulative)} {c}
                <span className="block font-ledger text-sm font-normal">
                  <MoneySourceLink project={project.id} user={user?.id ?? ""} />
                </span>
              </>
            ),
          },
          {
            label: "Spent this quarter",
            value: (
              <>
                {quarterSpendOf(v.saved, v.spend) === null ? "—" : `${num(quarterSpendOf(v.saved, v.spend)!)} ${c}`}
                {v.saved.quarterSpend !== null && v.spend.quarter !== null && <span className="block font-ledger text-xs font-normal text-warn">Typed in; the import says {num(v.spend.quarter)}</span>}
              </>
            ),
          },
        ]}
      />
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
          <input inputMode="decimal" className={`${input} font-mono`} value={spend} placeholder={v.spend.quarter === null ? "" : `${num(v.spend.quarter)} from the import`} onChange={(e) => setSpend(e.target.value)} />
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
    <div id="overspend" className="mt-4 scroll-mt-24 border-y border-ink">
      <p className="border-b border-line px-3 py-2 font-ledger text-base font-bold">Budget lines above budget</p>
      {lines.map((l) => (
        <div key={l.code} className="border-b border-line px-3 py-3 text-sm last:border-b-0">
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
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1">
        <h3 className="min-w-0 flex-1 font-ledger text-lg font-bold leading-tight">{heading ?? def?.heading}</h3>
        {saved?.drafted && <StatusBlock tone="ochre">Drafted by Claude: review</StatusBlock>}
        {saved?.from && <StatusBlock tone="ochre">Copied from {saved.from}: review</StatusBlock>}
        {saved && !saved.drafted && !saved.from && <span className="font-mono text-xs text-muted">Saved by {saved.by}</span>}
      </div>
      {def?.help && <p className="mt-1 text-xs text-muted">{def.help}</p>}
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
      {k === "lessons" && v.mayEdit && <LessonsFromRecord v={v} act={act} busy={busy} dirty={dirty} />}
    </section>
  );
}

/**
 * The quarter's lessons from the lessons record (Lessons and close-out), each added to the section
 * with one click, as an approved story goes to the Human Interest Story: nothing is typed twice,
 * and it works without AI.
 */
function LessonsFromRecord({ v, act, busy, dirty }: { v: QprView; act: Act; busy: string; dirty: boolean }) {
  const { tx } = useT();
  const text = v.saved.sections.lessons?.text ?? "";
  const cols = "7rem minmax(0,1fr)";
  if (!v.lessons.length)
    return (
      <p className="mt-2 border-y border-line px-3 py-2 text-xs text-muted">
        {tx("No lessons recorded this quarter.")}{" "}
        <Link href="/progress/learning" className="font-semibold text-forest hover:underline">
          {tx("Record them on Lessons and close-out")}
        </Link>
      </p>
    );
  return (
    <div className="mt-3 border-s-[6px] border-line ps-3 text-sm">
      <p className="font-mono text-xs text-muted">{tx("Lessons recorded this quarter")}</p>
      {!text.trim() && <p className="mt-1 text-sm">{v.lessons.length === 1 ? tx("1 lesson recorded this quarter is available. Use it below.") : tx("{n} lessons recorded this quarter are available. Use them below.", { n: v.lessons.length })}</p>}
      {dirty && <p className="mt-1 text-xs text-warn">{tx("Save your changes first, then add a lesson.")}</p>}
      <LedgerTable cols={cols} head={[tx("Date"), tx("Lesson")]} label={tx("Lessons recorded this quarter")} className="mt-1">
        {v.lessons.map((l) => {
          const used = text.includes(lessonForReport(l));
          return (
            <LedgerRow key={l.id} cols={cols} className="text-sm">
              <Fig tone="muted" className="text-start">
                {l.date}
              </Fig>
              <span className="min-w-0">
                <span className="font-semibold">{l.area}: </span>
                {l.lesson}
                <span className="mt-1 block">
                  {used ? (
                    <span className="font-mono text-xs text-muted">{tx("In the report")}</span>
                  ) : (
                    <button type="button" className={quietBtn} disabled={!!busy || dirty} onClick={() => void act({ action: "lesson-to-report", id: l.id }, tx("Added to Lessons Learned. Read it before the report goes out.")).catch(() => undefined)}>
                      {tx("Use in the report")}
                    </button>
                  )}
                </span>
              </span>
            </LedgerRow>
          );
        })}
      </LedgerTable>
    </div>
  );
}

/** The columns of the progress table on a wide screen: target, three figures, status and comment. */
const IND_COLS = "minmax(0,2fr) 7rem 7rem 7rem minmax(0,1.6fr)";

function IndicatorTable({ v, act }: { v: QprView; act: Act }) {
  const outputs = [...new Set(v.rows.map((r) => r.output))];
  const year = v.quarter.slice(0, 4);
  const qn = shortOf(v);
  const { t } = useT();
  return (
    <>
      {/* Below a wide screen: one block per target, stacked, so nothing scrolls sideways on a phone. */}
      <div className="mt-3 space-y-4 lg:hidden">
        {outputs.map((o) => (
          <div key={o}>
            <p className="border-y border-ink bg-sunken px-3 py-2 text-sm font-semibold">{o}</p>
            <div className="divide-y divide-line border-b border-ink">
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
        <LedgerTable
          cols={IND_COLS}
          label="Progress towards results"
          className="mt-0 min-w-[52rem]"
          head={["Output target", { label: t("rp.col.target", { year }), end: true }, { label: t("rp.col.quarter", { q: qn }), end: true }, { label: t("rp.col.year"), end: true }, "Status and comment"]}
        >
          {outputs.map((o) => (
            <Fragment key={o}>
              <div role="row" className="border-b border-line bg-sunken px-3 py-2 text-sm font-semibold">
                {o}
              </div>
              {v.rows
                .filter((r) => r.output === o)
                .map((r) => (
                  <IndicatorRow key={r.code} r={r} v={v} act={act} />
                ))}
            </Fragment>
          ))}
        </LedgerTable>
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
  const { from, to } = v.period;
  // As the report counts it (lib/qpr buildRows): a period that starts in the year before counts from its own start.
  const yearFrom = [`${v.quarter.slice(0, 4)}-01-01`, from].sort()[0];
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  // One tap opens the accepted results behind the figure and their proof (lib/evidence).
  // A survey target with no figure to give (lib/measure) shows why in its place: "Baseline needed" or "No survey yet".
  const evidence = (f: string, value: number, records: number, proof?: number, note?: string | null) => note ? (
    <span className="font-sans text-xs font-semibold text-clay">{note}</span>
  ) : (
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
        {evidence(yearFrom, r.year, r.records.year, undefined, r.note?.year)}
        {r.yearTarget > 0 && !r.note?.year && <span className="block text-xs text-muted">{Math.round((r.year / r.yearTarget) * 100)}%</span>}
    </>
  );
  // The one wording for a target's status (lib/target-status), as of the report's quarter.
  const st = targetStatus(r, Number(v.quarter.slice(-1)));
  const statusCell = (
    <>
        {editing ? (
          <div>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => {
                // The shared word first; the Word report prints UNDP's own term, which the comment starts with.
                const w = wordOfStatus(s);
                return (
                  <option key={s} value={s}>
                    {t(`prog.w.${w.word}`)}
                    {w.detail ? `, ${t(`prog.d.${w.detail}`)}` : ""} · {t("rp.wordTerm", { term: STATUS_LABEL[s] })}
                    {s === r.suggested ? " (suggested)" : ""}
                  </option>
                );
              })}
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
            <StatusBlock tone={st.tone}>{t(`prog.w.${st.word}`)}</StatusBlock>
            {st.detail && <span className="ms-1 text-xs text-muted">{t(`prog.d.${st.detail}`)}</span>}
            {!r.edited && <span className="ms-2 text-xs text-muted">suggested</span>}
            <span className="block text-xs text-muted">{t("rp.wordTerm", { term: STATUS_LABEL[r.status] })}</span>
            <p className="mt-1">{r.comment}</p>
            {v.mayEdit && (
              <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
        )}
    </>
  );
  const head = "font-mono text-xs text-muted";
  const fig = "font-mono text-sm tabular-nums";
  if (card)
    return (
      <div className="px-3 py-3 text-sm">
        <p>{name}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <dt className={head}>{t("rp.col.target", { year: v.quarter.slice(0, 4) })}</dt>
            <dd className={fig}>{num(r.yearTarget)}</dd>
          </div>
          <div>
            <dt className={head}>{t("rp.col.quarter", { q: shortOf(v) })}</dt>
            <dd className={fig}>{evidence(from, r.quarter, r.records.quarter, r.records.files, r.note?.quarter)}</dd>
          </div>
          <div>
            <dt className={head}>{t("rp.col.year")}</dt>
            <dd className={fig}>{yearCell}</dd>
          </div>
        </dl>
        <div className="mt-2">{statusCell}</div>
      </div>
    );
  return (
    <LedgerRow cols={IND_COLS} className="text-sm">
      <span className="min-w-0">{name}</span>
      <Fig>{num(r.yearTarget)}</Fig>
      <span className={`text-end ${fig}`}>{evidence(from, r.quarter, r.records.quarter, r.records.files, r.note?.quarter)}</span>
      <span className={`text-end ${fig}`}>{yearCell}</span>
      <span className="min-w-0">{statusCell}</span>
    </LedgerRow>
  );
}

function GenderStrip({ rows }: { rows: Row[] }) {
  const people = rows.filter((r) => r.women + r.men > 0);
  const women = people.reduce((t, r) => t + r.women, 0);
  const men = people.reduce((t, r) => t + r.men, 0);
  const wl = rows.reduce((t, r) => t + r.womenLed, 0);
  const ml = rows.reduce((t, r) => t + r.menLed, 0);
  if (!women && !men && !wl && !ml) return <Empty>No results this quarter record women and men separately.</Empty>;
  return (
    <p className="mt-3 border-y border-line px-3 py-3 text-sm">
      This quarter: <b className="font-mono tabular-nums">{num(women)}</b> {women === 1 ? "woman" : "women"} and <b className="font-mono tabular-nums">{num(men)}</b> {men === 1 ? "man" : "men"}{women + men > 0 && ` (${Math.round((women / (women + men)) * 100)}% women)`}
      {wl + ml > 0 && (
        <>
          {" "}
          · <b className="font-mono tabular-nums">{num(wl)}</b> women-led and <b className="font-mono tabular-nums">{num(ml)}</b> men-led businesses
        </>
      )}
      . Counted from accepted results; people may be counted under more than one target.
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
    <div id="grm" className="mt-6 scroll-mt-24 border-y border-line px-3 py-3 text-sm">
      <p>
        {log ? (
          <>
            From the feedback log: <b className="font-mono tabular-nums">{log.answered + log.open}</b> needing an answer, <b className="font-mono tabular-nums">{log.answered}</b> answered{log.open ? `, ${log.open} still open` : ""}
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
        <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline" onClick={() => setTyping(true)}>
          Type different figures instead
        </button>
      )}
      {typing && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Complaints received this quarter
            <input inputMode="numeric" className={`${input} font-mono`} value={rec} placeholder={log ? `${log.answered + log.open} from the log` : ""} disabled={!v.mayEdit} onChange={(e) => setRec(e.target.value)} />
          </label>
          <label className="text-sm">
            Resolved
            <input inputMode="numeric" className={`${input} font-mono`} value={res} placeholder={log ? `${log.answered} from the log` : ""} disabled={!v.mayEdit} onChange={(e) => setRes(e.target.value)} />
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
    <section id="risks" className="mt-6 scroll-mt-24">
      <h3 className="border-b border-line pb-1 font-ledger text-lg font-bold leading-tight">V. Risk Management</h3>
      <div className="mt-2">
        {list.map((r, k) => (
          <div key={k} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-line py-2 sm:grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span aria-hidden className="row-span-2 pt-3 font-mono text-xs text-muted sm:row-span-1">
              {String(k + 1).padStart(2, "0")}
            </span>
            <textarea className={input} rows={2} placeholder="Risk" value={r.risk} disabled={!v.mayEdit} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, risk: e.target.value } : x)))} />
            <textarea className={input} rows={2} placeholder="Mitigation measures" value={r.mitigation} disabled={!v.mayEdit} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, mitigation: e.target.value } : x)))} />
          </div>
        ))}
        {!list.length && <Empty className="mt-0">No risks listed.</Empty>}
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
      <p className="mt-2 border-y border-line px-3 py-2 text-xs text-muted">
        No activity updates or captioned photos this quarter.{" "}
        <Link href="/progress/results" className="font-semibold text-forest hover:underline">
          Add them on Results
        </Link>
      </p>
    );
  return (
    <div className="mt-3 space-y-4 border-s-[6px] border-line ps-3 text-sm">
      {updates.length > 0 && (
        <div>
          <p className="font-mono text-xs text-muted">Updates this quarter (Claude drafts from these)</p>
          <LedgerTable cols="7rem minmax(0,1fr)" head={["Date", "Update"]} label="Updates this quarter" className="mt-1">
            {updates.map((u) => (
              <LedgerRow key={u.id} cols="7rem minmax(0,1fr)" className="text-sm">
                <Fig tone="muted" className="text-start">
                  {u.date}
                </Fig>
                <span className="min-w-0">{u.note}</span>
              </LedgerRow>
            ))}
          </LedgerTable>
        </div>
      )}
      {tables.map((b) => {
        const cols = b.columns.map((_, j) => (j === 0 ? "minmax(8rem,1.5fr)" : "minmax(5rem,1fr)")).join(" ");
        const isNum = (j: number) => b.rows.some((r) => typeof r[j] === "number");
        return (
          <div key={b.indicator}>
            <p className="text-xs font-semibold">{b.title}</p>
            <div className="overflow-x-auto">
              <LedgerTable cols={cols} head={b.columns.map((c, j) => ({ label: c, end: isNum(j) }))} label={b.title} className="mt-1 min-w-[26rem]">
                {b.rows.map((r, k) => (
                  <LedgerRow key={k} cols={cols} className={`text-xs ${r[0] === "Total" ? "font-semibold" : ""}`}>
                    {r.map((c, j) =>
                      typeof c === "number" ? (
                        <Fig key={j} strong={r[0] === "Total"} className="text-xs">
                          {num(c)}
                        </Fig>
                      ) : (
                        <span key={j} className={isNum(j) ? "text-end font-mono tabular-nums" : ""}>
                          {c}
                        </span>
                      ),
                    )}
                  </LedgerRow>
                ))}
              </LedgerTable>
            </div>
          </div>
        );
      })}
      {photos.length > 0 && (
        <div>
          <p className="font-mono text-xs text-muted">Photos in the report ({photos.length})</p>
          <ul className="mt-1 border-t border-line">
            {photos.map((ph) => (
              <li key={ph.hash} className="border-b border-line">
                <button type="button" className="min-h-11 w-full py-2 text-start font-semibold text-forest hover:underline" onClick={() => void openReceipt(ph.hash, user?.id)}>
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
    <details className="mt-6 border-y border-line">
      <summary className="min-h-12 cursor-pointer py-3 font-ledger text-lg font-bold">
        Acronyms <span className="font-mono text-sm font-normal text-muted">({v.saved.acronyms?.length ?? 0})</span>
      </summary>
      <p className="mt-1 text-xs text-muted">One per line, as &ldquo;IWRM: Integrated Water Resources Management&rdquo;. Kept from quarter to quarter. The Word file also gets a table of contents.</p>
      <textarea className={`${input} font-mono text-sm`} rows={8} value={text} disabled={!v.mayEdit} onChange={(e) => setText(e.target.value)} />
      {v.mayEdit && dirty && (
        <button type="button" className={`${primaryBtn} mt-2`} onClick={() => void act({ action: "acronyms", acronyms: parse() }, "Saved.").catch(() => undefined)}>
          Save acronyms
        </button>
      )}
      <div className="h-3" />
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
      <summary className="min-h-11 cursor-pointer py-1">
        {summary}
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </summary>
      {children}
    </details>
  );
}

/**
 * When the Report check could not load: the report's own checks, so the blocking count in the
 * header is never shown without the list behind it. It takes the check's place at #checks.
 */
function OwnChecks({ checks, quarter }: { checks: QprView["checks"]; quarter: string }) {
  const { t } = useT();
  useEffect(() => {
    const go = () => document.getElementById("checks")?.scrollIntoView({ block: "start" });
    window.addEventListener(OPEN_CHECKS, go);
    return () => window.removeEventListener(OPEN_CHECKS, go);
  }, []);
  const stops = checks.filter((c) => c.level === "stop");
  const rest = checks.filter((c) => c.level !== "stop");
  return (
    <section id="checks" className={`mt-4 scroll-mt-20 border-s-[6px] ${stops.length ? "border-clay" : rest.length ? "border-ochre" : "border-leaf"} bg-surface px-3 py-2 print:hidden`}>
      <p className="font-ledger text-lg font-bold">{t("pf.title")}</p>
      <p role="status" className="mt-1 text-sm text-warn">{t("pf.notLoaded")}</p>
      {[
        { label: t("pf.blocks"), list: stops, tone: "text-clay", start: 1 },
        { label: t("pf.fix"), list: rest, tone: "text-warn", start: stops.length + 1 },
      ].map((g) =>
        g.list.length ? (
          <div key={g.label} className="mt-3">
            {/* The group's name sits in the column head; on a phone, where the head hides, it sits above. */}
            <p className={`font-mono text-sm font-bold sm:hidden ${g.tone}`}>
              {g.label} {g.list.length}
            </p>
            <LedgerTable
              cols="2.25rem minmax(0,1fr)"
              head={["#", { label: <span className={`font-bold ${g.tone}`}>{`${g.label} ${g.list.length}`}</span> }]}
              label={g.label}
              className="mt-1 text-sm sm:mt-0"
            >
              {g.list.map((c, i) => (
                <LedgerRow key={i} n={g.start + i} cols="minmax(0,1fr)" href={checkHref(c, quarter)}>
                  <span className="min-w-0">{itemText(t, c)}</span>
                </LedgerRow>
              ))}
            </LedgerTable>
          </div>
        ) : null,
      )}
    </section>
  );
}
