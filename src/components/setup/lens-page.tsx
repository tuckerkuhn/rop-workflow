"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { userById } from "@/lib/demo";
import { LENSES, type Finding, type LensAction, type LensReview } from "@/lib/lens-review";

/** The plan read through ROP's reviewer lenses: AI finds the gaps, a person decides on each one. */

type View = { review: LensReview | null; mayRun: boolean; aiReady: boolean };
const SEVERITY: Record<Finding["severity"], "clay" | "ochre" | "muted"> = { high: "clay", medium: "ochre", low: "muted" };
const who = (id: string) => userById(id)?.name ?? id;

export function LensPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${project.id}/lens-review`;

  const load = useCallback(async () => {
    if (!user || !project.saved) return;
    const r = await fetch(url, { cache: "no-store", headers: { "x-demo-user": user.id } });
    const d = await r.json();
    if (r.ok) setV(d);
    else setError(d.error ?? "Could not load the lens review.");
  }, [user, project.saved, url]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (a: LensAction) => {
    if (!user) return false;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Not saved.");
      setV(d);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  const all = v?.review?.lenses.flatMap((l) => l.findings) ?? [];
  const open = all.filter((f) => !f.decision).length;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Lens review</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          AI reads the plan in setup (goal, indicators and targets, budget by activity, workplan) through each of ROP&rsquo;s reviewer lenses and lists the gaps. It decides nothing: for each finding, someone says what will change, or why it does not apply.
        </p>
        {!project.saved ? (
          <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only.</p>
        ) : (
          v && (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {v.mayRun && (
                  <button type="button" className={primaryBtn} disabled={busy || !v.aiReady} onClick={() => void act({ action: "run" })}>
                    {busy ? "Reviewing… (about a minute)" : v.review ? "Review the plan again" : "Review the plan"}
                  </button>
                )}
                {!v.aiReady && <span className="text-sm text-muted">AI is not set up on this server.</span>}
                {v.review && (
                  <span className="text-sm text-muted">
                    Last run by {who(v.review.by)} on {v.review.at.slice(0, 10)} ({v.review.model}) · {all.length} findings, {open} to decide
                  </span>
                )}
              </div>
              {error && (
                <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
                  {error}
                </p>
              )}
              {v.review && v.review.questions.length > 0 && (
                <section className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm">
                  <SectionLabel>Facts the review needs</SectionLabel>
                  <ul className="mt-2 list-disc space-y-1 ps-5">
                    {v.review.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </section>
              )}
              {v.review &&
                v.review.lenses.map((l) => {
                  const lens = LENSES.find((x) => x.id === l.lens)!;
                  return (
                    <section key={l.lens} className="mt-6">
                      <SectionLabel>{lens.label}</SectionLabel>
                      <p className="mt-1 text-xs text-muted">{lens.asks}</p>
                      {l.summary && <p className="mt-2 text-sm">{l.summary}</p>}
                      {l.findings.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">No gaps found through this lens.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {l.findings.map((f) => (
                            <FindingItem key={f.id} f={f} mayDecide={v.mayRun} busy={busy} act={act} />
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
            </>
          )
        )}
      </main>
    </div>
  );
}

function FindingItem({ f, mayDecide, busy, act }: { f: Finding; mayDecide: boolean; busy: boolean; act: (a: LensAction) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  return (
    <li className="rounded-xl border border-line bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={SEVERITY[f.severity]}>{f.severity}</Pill>
        <span className="font-semibold">{f.gap}</span>
      </div>
      <p className="mt-1 text-muted">{f.why}</p>
      <p className="mt-1">
        <span className="font-semibold">Suggestion:</span> {f.suggestion}
      </p>
      {f.decision ? (
        <p className="mt-2 text-xs">
          <span className={f.decision.action === "act" ? "font-semibold text-forest" : "font-semibold text-muted"}>{f.decision.action === "act" ? "Will act" : "Dismissed"}</span> by {who(f.decision.by)} on {f.decision.at.slice(0, 10)}: {f.decision.note}
        </p>
      ) : (
        mayDecide && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What will change, or why it does not apply" aria-label="Decision" />
            <button type="button" className={primaryBtn} disabled={busy || note.trim().length < 5} onClick={() => void act({ action: "decide", id: f.id, decision: "act", note }).then((ok) => ok && setNote(""))}>
              Will act
            </button>
            <button type="button" className={quietBtn} disabled={busy || note.trim().length < 5} onClick={() => void act({ action: "decide", id: f.id, decision: "dismiss", note }).then((ok) => ok && setNote(""))}>
              Dismiss
            </button>
          </div>
        )
      )}
    </li>
  );
}
