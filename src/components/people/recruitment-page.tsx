"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import { MIN_OPEN_DAYS, type RecAction } from "@/lib/recruitment";
import type { RecruitmentView } from "@/app/api/recruitment/route";

/**
 * Recruitment (MF-05): HR opens a vacancy for at least 14 days with a panel of 3 or 4 at or above
 * its grade, records and grades every CV, shortlists 3 to 5, takes references for finalists after
 * the interviews, and writes the selection memo. The panel scores the shortlist here.
 */
type V = RecruitmentView["vacancies"][number];
const field = "mt-1 w-full border border-line bg-surface px-3 py-2 text-sm";
const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function RecruitmentPage() {
  const { user } = useRequireUser();
  const [v, setV] = useState<RecruitmentView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    const r = await fetch("/api/recruitment", { cache: "no-store", headers: { "x-demo-user": user.id } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setError(b.error ?? plainError(r.status));
    setV(b);
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (a: RecAction, done: string) => {
    setError("");
    setNotice("");
    const r = await fetch("/api/recruitment", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" }, body: JSON.stringify(a) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setError(b.error ?? plainError(r.status)), false;
    setV(b);
    setNotice(done);
    return true;
  };
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Recruitment</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A vacancy is open at least {MIN_OPEN_DAYS} days. Every CV is graded; 3 to 5 are shortlisted; a panel of 3 or 4 at or above the post&apos;s grade scores the interviews, and HR does not score. References come after the interviews, for finalists only. The selection memo says who and, when it is not the top score, why.
        </p>
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && <p className="mt-4 bg-mist px-4 py-3 text-sm">{notice}</p>}
        {v?.isHr && <OpenForm v={v} act={act} />}
        {v && !v.vacancies.length && <p className="mt-6 text-sm text-muted">{v.isHr ? "No vacancies yet." : "You sit on no hiring panel."}</p>}
        <ul className="mt-6 space-y-4">
          {v?.vacancies.map((x) => (
            <VacancyCard key={x.n} x={x} v={v} act={act} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function OpenForm({ v, act }: { v: RecruitmentView; act: (a: RecAction, done: string) => Promise<boolean> }) {
  const [f, setF] = useState({ title: "", grade: "", office: "Afghanistan", opened: v.today, closes: plus(v.today, MIN_OPEN_DAYS), panel: [] as string[] });
  return (
    <form
      className="mt-6 grid gap-3 border border-line bg-surface p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "open", title: f.title, grade: Number(f.grade), office: f.office, opened: f.opened, closes: f.closes, panel: f.panel }, "Vacancy opened.");
      }}
    >
      <p className="font-semibold sm:col-span-3">Open a vacancy</p>
      <label className="block text-sm font-medium">
        Post
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Grade
        <input inputMode="numeric" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value.replace(/\D/g, "") })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Office
        <input value={f.office} onChange={(e) => setF({ ...f, office: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Advertised from
        <input type="date" value={f.opened} onChange={(e) => setF({ ...f, opened: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Closes (at least {MIN_OPEN_DAYS} days later)
        <input type="date" value={f.closes} min={plus(f.opened, MIN_OPEN_DAYS)} onChange={(e) => setF({ ...f, closes: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Panel (3 or 4, Ctrl or Cmd for more)
        <select multiple value={f.panel} onChange={(e) => setF({ ...f, panel: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${field} h-28`}>
          {v.staff.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.grade !== null ? ` (grade ${p.grade})` : " (no grade recorded)"}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-3">
        <button type="submit" className={primaryBtn} disabled={!f.title.trim() || !f.grade || f.panel.length < 3}>
          Open the vacancy
        </button>
      </div>
    </form>
  );
}

function VacancyCard({ x, v, act }: { x: V; v: RecruitmentView; act: (a: RecAction, done: string) => Promise<boolean> }) {
  const [cand, setCand] = useState({ name: "", related: "none", received: v.today });
  const [short, setShort] = useState<number[]>(x.shortlist);
  const [score, setScore] = useState<Record<number, string>>({});
  const [ref, setRef] = useState<Record<number, { from: string; summary: string }>>({});
  const [memo, setMemo] = useState({ candidate: 0, memo: "", deviation: "" });
  const onPanel = x.panel.includes(v.me);
  return (
    <li className="border border-line bg-surface p-4 text-sm">
      <p className="text-lg font-semibold">
        #{x.n} {x.title}, grade {x.grade}, {x.office}
      </p>
      <p className="text-muted">
        Advertised {x.opened} to {x.closes} · panel: {x.panelNames.join(", ")}
        {x.selected ? ` · filled` : ""}
      </p>
      {x.selected && (
        <p className="mt-2 bg-mist px-3 py-2">
          Chosen: {x.candidates.find((c) => c.n === x.selected!.candidate)?.name}. {x.selected.memo}
          {x.selected.deviation ? ` Not the top score because: ${x.selected.deviation}` : ""}{" "}
          {v.isHr && (
            <Link href="/people" className="font-semibold text-forest underline">
              Propose the hire in the HR record
            </Link>
          )}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {x.candidates.map((c) => (
          <li key={c.n} className="flex flex-wrap items-center gap-2 py-2">
            {v.isHr && !x.selected && x.shortlist.length === 0 && <input type="checkbox" checked={short.includes(c.n)} onChange={(e) => setShort(e.target.checked ? [...short, c.n] : short.filter((n) => n !== c.n))} aria-label={`Shortlist ${c.name}`} />}
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{c.name}</span> · related to staff: {c.related || "none"} · CV {c.cvGrade ?? "not graded"}
              {x.shortlist.includes(c.n) ? ` · shortlisted · panel ${c.score ?? "not all scored"}` : ""}
              {c.references.length ? ` · ${c.references.length} reference` : ""}
            </span>
            {v.isHr && !x.selected && c.cvGrade === undefined && (
              <select defaultValue="" onChange={(e) => e.target.value && void act({ action: "grade", vacancy: x.n, candidate: c.n, score: Number(e.target.value) }, `CV graded.`)} className="border border-line px-2 py-1" aria-label="CV grade">
                <option value="">Grade the CV</option>
                {[1, 2, 3, 4, 5].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            )}
            {onPanel && x.shortlist.includes(c.n) && !x.selected && (
              <span className="flex items-center gap-1">
                <input inputMode="decimal" placeholder={c.myScore !== null ? String(c.myScore) : "0 to 100"} value={score[c.n] ?? ""} onChange={(e) => setScore({ ...score, [c.n]: e.target.value })} className="w-24 border border-line px-2 py-1" aria-label="Your score" />
                <button type="button" className={quietBtn} onClick={() => void act({ action: "score", vacancy: x.n, candidate: c.n, score: Number(score[c.n]) }, "Score recorded.")}>
                  Score
                </button>
              </span>
            )}
            {v.isHr && c.score !== null && !x.selected && (
              <span className="flex flex-wrap items-center gap-1">
                <input placeholder="Reference from" value={ref[c.n]?.from ?? ""} onChange={(e) => setRef({ ...ref, [c.n]: { from: e.target.value, summary: ref[c.n]?.summary ?? "" } })} className="w-36 border border-line px-2 py-1" />
                <input placeholder="What they said" value={ref[c.n]?.summary ?? ""} onChange={(e) => setRef({ ...ref, [c.n]: { from: ref[c.n]?.from ?? "", summary: e.target.value } })} className="w-48 border border-line px-2 py-1" />
                <button type="button" className={quietBtn} onClick={() => void act({ action: "reference", vacancy: x.n, candidate: c.n, from: ref[c.n]?.from ?? "", summary: ref[c.n]?.summary ?? "" }, "Reference recorded.")}>
                  Add reference
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {v.isHr && !x.selected && (
        <div className="mt-3 space-y-3">
          {x.shortlist.length === 0 && x.candidates.length >= 3 && (
            <button type="button" className={quietBtn} disabled={short.length < 3 || short.length > 5} onClick={() => void act({ action: "shortlist", vacancy: x.n, candidates: short }, "Shortlist recorded: the panel scores the interviews.")}>
              Shortlist the {short.length} ticked (3 to 5)
            </button>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input placeholder="Candidate's name" value={cand.name} onChange={(e) => setCand({ ...cand, name: e.target.value })} className="border border-line px-2 py-1.5" />
            <input placeholder="Related to anyone on staff?" value={cand.related} onChange={(e) => setCand({ ...cand, related: e.target.value })} className="border border-line px-2 py-1.5" />
            <input type="date" value={cand.received} onChange={(e) => setCand({ ...cand, received: e.target.value })} className="border border-line px-2 py-1.5" aria-label="Received" />
            <button type="button" className={quietBtn} disabled={cand.name.trim().length < 2} onClick={() => void act({ action: "candidate", vacancy: x.n, ...cand }, "Application recorded.").then((ok) => ok && setCand({ name: "", related: "none", received: v.today }))}>
              Add an application
            </button>
          </div>
          {x.candidates.some((c) => c.score !== null && c.references.length) && (
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={memo.candidate} onChange={(e) => setMemo({ ...memo, candidate: Number(e.target.value) })} className="border border-line px-2 py-1.5" aria-label="Chosen candidate">
                <option value={0}>Choose the finalist</option>
                {x.candidates
                  .filter((c) => c.score !== null && c.references.length)
                  .map((c) => (
                    <option key={c.n} value={c.n}>
                      {c.name} ({c.score})
                    </option>
                  ))}
              </select>
              <input placeholder="If not the top score: why" value={memo.deviation} onChange={(e) => setMemo({ ...memo, deviation: e.target.value })} className="border border-line px-2 py-1.5" />
              <textarea placeholder="Selection memo: who, and why" value={memo.memo} onChange={(e) => setMemo({ ...memo, memo: e.target.value })} className="border border-line px-2 py-1.5 sm:col-span-2" rows={3} />
              <button type="button" className={primaryBtn} disabled={!memo.candidate || memo.memo.trim().length < 20} onClick={() => void act({ action: "select", vacancy: x.n, candidate: memo.candidate, memo: memo.memo, ...(memo.deviation.trim() ? { deviation: memo.deviation.trim() } : {}) }, "Selection memo recorded. Propose the hire in the HR record next.")}>
                Record the selection
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
