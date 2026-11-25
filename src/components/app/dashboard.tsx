"use client";

import { acct, opening } from "@/lib/file-store";
import { useCloseouts, usePlan, useProcurements } from "@/components/app/use-project-data";

import Link from "next/link";
import { useEffect, useState } from "react";
import { stageOf } from "@/components/field/workspace";
import { useFieldData, useProgress, useSubmissions } from "@/components/app/use-project-data";
import { useProjectStage } from "@/components/app/project-stage";
import { PROJECT_KEY } from "@/lib/project";
import { useCurrentProject } from "@/components/app/current-project";
import { DonorReportsCard } from "@/components/donor/home-card";
import { useT } from "@/components/app/i18n";
import { Initials, useRequireUser, useSession } from "@/components/app/session";
import { HomePanels } from "@/components/home/panels";
import { RoleHome } from "@/components/home/role-home";
import { HrHome } from "@/components/home/hr-home";
import { holdsType } from "@/lib/authority";
import { Pill, SectionLabel, TopBar, usePersistentState } from "@/components/workspace/ui";
import { workFor, type Data, type WorkCard } from "@/components/tasks/work";
import { PROJECT, daysFrom, directReports, userById, type AppUser } from "@/lib/demo";
import { DEMO_SETUP, describePackage } from "@/lib/package";
import { PACKAGE_USD, farmerName, farmerStages, fieldRoleLabel, maskName, type Farmer, type FieldItem } from "@/lib/field";
import { DONE, procRolesFor, roleLabel, valueOf } from "@/lib/procurement";
import { GATED_KEYS, seedProject, type ProjectState } from "@/lib/project";
import { onDemoClock, today } from "@/lib/clock";
import type { HrSummary } from "@/server/hr-summary";

const buckets = [
  { label: "This week", max: 6 },
  { label: "Next week", max: 13 },
  { label: "In 2–4 weeks", max: 31 },
  { label: "Later", max: Infinity },
];

function Pipeline({ cards }: { cards: WorkCard[] }) {
  const grouped = buckets.map((b, k) => ({
    ...b,
    cards: cards.filter((c) => {
      const d = daysFrom(today(), c.date);
      return d <= b.max && (k === 0 || d > buckets[k - 1].max);
    }),
  }));
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {grouped.map((g) => (
        <div key={g.label} className="min-w-0 rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between px-1">
            <p className="text-sm font-semibold">{g.label}</p>
            <p className="text-xl tabular-nums text-muted font-semibold">{g.cards.length}</p>
          </div>
          <ul className="mt-2 space-y-2">
            {g.cards.map((c) => (
              <li key={c.key}>
                <Link
                  href={c.href}
                  className={`block rounded-xl border px-3 py-2 transition hover:border-forest ${c.late ? "border-clay/50 bg-clay-soft/50" : c.now ? "border-forest/40 bg-mist/60" : "border-dashed border-line bg-paper"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">{c.space}</span>
                    <span className={`font-mono text-xs ${c.late ? "text-clay" : c.now ? "text-forest" : "text-warn"}`}>
                      {c.late ? "late · " : c.now ? "" : "~"}
                      {c.date.slice(5)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium">{c.title}</p>
                  <p className="truncate text-xs text-muted">
                    {c.now ? "Now · " : "Projected · "}
                    {c.step}
                  </p>
                </Link>
              </li>
            ))}
            {g.cards.length === 0 && <li className="px-1 text-xs text-muted">Nothing expected.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function rolesOf(u: AppUser) {
  return [
    ...u.field.map(fieldRoleLabel),
    ...u.procurement.map(roleLabel),
    ...u.project.map((r) => ({ "plan-approver": "Plan approver", "monthly-review": "Monthly review", "report-release": "Report release", "mel-owner": "MEL owner", "finance-import": `${opening(acct())} import`, comms: "Communications", "technical-lead": "Technical lead" })[r]),
  ].filter((r) => r.toLowerCase() !== u.title.toLowerCase());
}

/** A manager's view of each direct report: what they hold, what is late, and what is coming. */
function Team({ u, data, viewer, onView }: { u: AppUser; data: Data; viewer: AppUser; onView: (id: string) => void }) {
  const team = directReports(u.id);
  if (!team.length) return null;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Your team · {team.length} direct reports</SectionLabel>
        <p className="text-xs text-muted">Late means the step has taken longer than its usual time.</p>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {team.map((m) => {
          const cards = workFor(m, data, viewer);
          const now = cards.filter((c) => c.now);
          const late = now.filter((c) => c.late);
          const soon = cards.filter((c) => !c.now && daysFrom(today(), c.date) <= 13);
          const sub = directReports(m.id).length;
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onView(m.id)} className="w-full rounded-2xl border border-line bg-surface p-4 text-start transition hover:-translate-y-0.5 hover:border-forest">
                <div className="flex items-center gap-3">
                  <Initials name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight">{m.name}</p>
                    <p className="truncate text-xs text-muted">
                      {m.title}
                      {sub ? ` · manages ${sub}` : ""}
                    </p>
                  </div>
                  {late.length > 0 && <Pill tone="clay">{late.length} late</Pill>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Now", now.length],
                    ["Late", late.length],
                    ["Next 2 wks", soon.length],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-paper py-2">
                      <dd className={`font-display text-2xl tabular-nums ${k === "Late" && Number(v) > 0 ? "text-clay" : ""}`}>{v}</dd>
                      <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 truncate text-xs text-muted">{now[0] ? `Next: ${now[0].step} · ${now[0].title}` : "Nothing waiting on them"}</p>
                {m.feedback && (
                  <p className="mt-1 text-xs text-muted">
                    Farmer feedback {m.feedback.score.toFixed(1)} / 5 ({m.feedback.n})
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmployeeHome({ u, data, viewer, readOnly, onView }: { u: AppUser; data: Data; viewer: AppUser; readOnly: boolean; onView: (id: string) => void }) {
  const cards = workFor(u, data, viewer);
  const now = cards.filter((c) => c.now);
  const late = now.filter((c) => c.late);
  const soon = cards.filter((c) => !c.now && daysFrom(today(), c.date) <= 13);
  const roleNames = rolesOf(u);
  const who = readOnly ? u.name.split(" ")[0] : "you";

  return (
    <>
      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[
          [`Waiting on ${who}`, String(now.length), now.length ? "Shown below, earliest first" : "All caught up"],
          ["Running late", String(late.length), late.length ? "Longer than the usual step time" : "Nothing late"],
          ["Coming in 2 weeks", String(soon.length), "Projected from past step times"],
          ["Roles", String(roleNames.length), roleNames.join(" · ") || "View only"],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-surface px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className={`mt-1 font-display text-4xl tabular-nums ${k === "Running late" && v !== "0" ? "text-clay" : ""}`}>{v}</p>
            <p className="mt-1 truncate text-xs text-muted">{s}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>{readOnly ? `${u.name.split(" ")[0]}'s work pipeline` : "Your work pipeline"}</SectionLabel>
          <p className="text-xs text-muted">Solid: held now, with the expected finish. Dashed: projected arrival from median step times. Red: running late.</p>
        </div>
        <div className="mt-3">{cards.length ? <Pipeline cards={cards} /> : <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">No work assigned to these roles.</p>}</div>
      </section>

      <Team u={u} data={data} viewer={viewer} onView={onView} />

    </>
  );
}

/**
 * For a donor on a database project: the project's own targets, counted the way every other
 * screen counts them (accepted results only), before anything about the season. The first four,
 * impact first; the rest are a tap away on Progress. Figures only: whether a target is on track is
 * judged from the workplan on staff screens, and a second judgment here could contradict it.
 */
function DonorTargets({ code }: { code: string }) {
  const { t } = useT();
  const { data } = useProgress(code);
  const list = [...(data?.indicators ?? [])].sort((a, b) => Number(a.level === "output") - Number(b.level === "output")).slice(0, 4);
  if (!data?.saved || !list.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Results against targets</SectionLabel>
        <Link href="/progress" className="btn-link">
          Every target and its proof →
        </Link>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {list.map((i) => {
          const pct = i.total === null || !i.target ? 0 : Math.min(100, Math.round((i.total / i.target) * 100));
          return (
            <li key={i.code}>
              <p className="text-sm font-medium leading-snug">{i.name}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl tabular-nums">{i.total ?? "—"}</span>
                <span className="text-sm text-muted">{t("progress.ofTarget", { target: i.target, unit: i.unit })}</span>
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${pct}% of the target`}>
                <div className={`h-full rounded-full ${pct >= 100 ? "bg-leaf" : "bg-forest"}`} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DonorHome({ field, project }: { field: FieldItem[]; project: ProjectState }) {
  const { money, user } = useSession();
  // A database project speaks for itself; the demo projects kept in the browser use the sample package and season.
  const { project: current } = useCurrentProject();
  const farmers = field.filter((i): i is Farmer => i.kind === "farmer");
  const active = farmers.filter((f) => f.step !== "removed");
  const supplied = farmers.filter((f) => ["plant", "complete"].includes(f.step));
  const latestScores = active.map((f) => f.surveys[f.surveys.length - 1]?.score).filter(Boolean) as number[];
  const avg = latestScores.reduce((s, x) => s + x, 0) / (latestScores.length || 1);
  const stories = farmers.flatMap((f) => f.stories.filter((s) => s.status === "completed").map((s) => ({ ...s, farmer: f })));
  const photos = farmers
    .flatMap((f) => f.photos.map((p) => ({ ...p, farmer: f })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  return (
    <>
      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[
          ["Farmers enrolled", String(active.length)],
          ["Received inputs", current.saved ? String(supplied.length) : `${supplied.length} · ${money(supplied.length * PACKAGE_USD)}`],
          ["Average satisfaction", latestScores.length ? `${avg.toFixed(1)} / 5` : "No ratings yet"],
          ["Success stories", String(stories.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className={`mt-1 font-display tabular-nums ${/^\d/.test(v) ? "text-3xl" : "pt-2 text-lg text-muted"}`}>{v}</p>
          </div>
        ))}
      </section>

      {current.saved && <DonorTargets code={current.id} />}

      {current.saved ? (
        <DonorReportsCard code={current.id} />
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
          <div>
            <p className="font-semibold">March progress report</p>
            <p className="text-sm text-muted">
              {project.reportRelease
                ? `Released by ${userById(project.reportRelease.by)?.name} on ${project.reportRelease.date}. Click any number to see its evidence.`
                : "Not released yet. You will see it here once Roots of Peace signs it off."}
            </p>
          </div>
          {project.reportRelease && (
            <Link href="/progress" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-forest-ink">
              Read the report
            </Link>
          )}
        </section>
      )}

      {/* The season's steps, where the project runs the farmer workflow. */}
      {(!current.saved || farmers.length > 0) && (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>{current.saved ? current.name : `${PROJECT.name} · ${PROJECT.season}`}</SectionLabel>
          <Link href="/work?source=field" className="btn-link">
            View field activities →
          </Link>
        </div>
        <ol className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {farmerStages.map((label, k) => {
            const n = active.filter((f) => stageOf(f) === k).length + (k === farmerStages.length - 1 ? active.filter((f) => f.step === "complete").length : 0);
            return (
              <li key={label} className="rounded-xl bg-paper px-3 py-3 text-center">
                <p className="font-display text-3xl tabular-nums">{n}</p>
                <p className="text-xs text-muted">{label}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted">{current.saved ? "Participants are shown by farmer ID." : `Inputs per farmer: ${describePackage(DEMO_SETUP)} (${money(PACKAGE_USD)}). Participants are shown by farmer ID.`}</p>
      </section>
      )}

      <section>
        <SectionLabel>Success stories</SectionLabel>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {stories.map((s) => (
            <article key={s.id + s.farmer.id} className="rounded-2xl border border-forest/30 bg-mist p-5">
              <p className="font-display text-2xl leading-snug text-forest">{s.title}</p>
              <p className="mt-2 leading-relaxed">{maskName(s.text, s.farmer, user)}</p>
              <Link href={`/field/farmers/${s.farmer.id}`} className="btn-link mt-3">
                {farmerName(s.farmer, user)}&rsquo;s profile →
              </Link>
            </article>
          ))}
          {stories.length === 0 && <p className="text-sm text-muted">No completed stories yet.</p>}
        </div>
      </section>

      {photos.length > 0 && (
        <section>
          <SectionLabel>Recent field photos</SectionLabel>
          <p className="mt-1 text-xs text-muted">Shown on each farmer&rsquo;s profile. Sample records use drawn placeholders.</p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id}>
                <Link href={`/field/farmers/${p.farmer.id}`} className="block rounded-xl border border-line bg-surface px-3 py-3 text-sm hover:border-forest">
                  <p className="font-medium">{farmerName(p.farmer, user)}</p>
                  <p className="text-xs text-muted">
                    {p.date} · {p.caption.split(" · ")[0]}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * The person's HR summary (api/hr/summary), asked for once per visit to Home: the first-steps panel
 * at the top and the cards below share one request.
 */
const hrSummaries = new Map<string, { at: number; p: Promise<HrSummary | null> }>();
function useHrSummary(userId: string | undefined) {
  const [sum, setSum] = useState<HrSummary | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    let got = hrSummaries.get(userId);
    if (!got || Date.now() - got.at > 5_000) {
      got = {
        at: Date.now(),
        p: fetch("/api/hr/summary", { cache: "no-store", headers: { "x-demo-user": userId } })
          .then((r) => (r.ok ? (r.json() as Promise<HrSummary>) : null))
          .catch(() => null),
      };
      hrSummaries.set(userId, got);
    }
    void got.p.then((v) => live && setSum(v));
    return () => {
      live = false;
    };
  }, [userId]);
  return sum;
}

/** A new person's first steps, first on Home until they are done: nothing else matters as much in week one. */
function FirstSteps() {
  const { user } = useSession();
  const ob = useHrSummary(user?.id)?.onboarding?.mine;
  if (!ob || ob.done >= ob.total) return null;
  return (
    <Link href="/onboarding" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-ochre bg-ochre-soft px-5 py-4 transition hover:border-forest">
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">Your first steps at ROP</span>
        <span className="block text-sm text-muted">
          {ob.done} of {ob.total} done. Give your details, read the policies, sign your contract and upload your ID. Your supervisor and HR do the rest.
        </span>
      </span>
      <span className="inline-flex min-h-12 items-center rounded-xl bg-forest px-5 font-semibold text-forest-ink">Continue</span>
    </Link>
  );
}

/** The HR record on Home: changes waiting for this person's signature, their timesheet, and timesheets to approve. */
/**
 * The person's own admin, only for people with an HR record: my timesheet, my leave, my expenses,
 * my onboarding, and my details (read-only). Approvals and other people's records are in Work,
 * under Needs my attention.
 */
function PeopleCard() {
  const { user } = useSession();
  const { date, t } = useT();
  // One request for the four parts (api/hr/summary) instead of one each, shared with the first-steps panel.
  const sum = useHrSummary(user?.id);
  const ts = sum?.timesheet;
  const ex = sum?.expenses;
  const lv = sum?.leave;
  if (!ts?.hasRecord) return null;
  const tsText: Record<string, string> = { missing: "not submitted yet", pending: "waiting for approval", approved: "approved", returned: "sent back: open it to see why" };
  // Ruled rows (the Ledger template), not cards: what needs doing reads in warm text, the rest muted.
  const row = "group flex min-h-12 items-center gap-x-4 gap-y-1 border-b border-line px-1 py-2.5 text-sm hover:bg-ochre-soft";
  const status = (on: boolean) => (on ? "font-semibold text-warn" : "text-muted");
  const items: { href: string; label: string; text: string; on: boolean }[] = [
    { href: "/timesheets", label: "Timesheet", text: `${date(`${ts.month}-01`, { month: "long" })}: ${tsText[ts.status] ?? ts.status}`, on: ts.status === "returned" || ts.status === "missing" },
    ...(lv?.hasRecord ? [{ href: "/leave", label: "Leave", text: [lv.annualDays != null ? `${lv.annualDays} days of annual leave` : "", lv.returned ? `${lv.returned} sent back` : ""].filter(Boolean).join(" · ") || "Ask for leave", on: !!lv.returned }] : []),
    ...(ex?.hasRecord ? [{ href: "/expenses", label: "Expenses", text: ex.returned ? `${ex.returned} sent back to you` : "Claim expenses with receipts", on: !!ex.returned }] : []),
    { href: "/people/me", label: t("home.myDetails"), text: t("home.myDetailsHint"), on: false },
  ];
  // Unfinished first steps are shown at the top of Home (FirstSteps), not here.
  return (
    <section aria-labelledby="my-own" className="font-ledger">
      <h2 id="my-own" className="border-s-[6px] border-ochre ps-2.5 text-xl font-bold leading-tight text-ink">
        Your own
      </h2>
      <div className="mt-2 grid border-t border-ink sm:grid-cols-2 sm:gap-x-8">
        {items.map((x) => (
          <Link key={x.href} href={x.href} className={row}>
            <span className="w-28 shrink-0 font-semibold text-ink">{x.label}</span>
            <span className={`min-w-0 flex-1 ${status(x.on)}`}>{x.text}</span>
            <span aria-hidden className="text-muted group-hover:text-forest">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** For administrators: conflicts between the organization's and the donor's rules on this project, waiting for a decision. */
function RulesConflicts() {
  const { user } = useSession();
  const { project, policy, reloadPolicy } = useCurrentProject();
  // The project's rules were fetched by CurrentProjectProvider: read them from there. Coming back to
  // Home later (a rule may have been decided since) asks the provider to fetch them again.
  // While no answer for this project is here, the provider is already fetching it.
  const loaded = policy?.projectId === project.id ? policy : null;
  const show = !!user?.admin && project.saved;
  useEffect(() => {
    if (show && loaded && Date.now() - loaded.at > 30_000) reloadPolicy();
    // Only on arriving at Home or changing project, not each time the answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, project.id]);
  const open = show ? (loaded?.answer?.open.length ?? 0) : 0;
  if (!open) return null;
  return (
    <Link href="/settings/policy" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-clay bg-clay-soft px-5 py-3 text-sm text-clay transition hover:border-forest">
      <span className="font-semibold">Rules to decide</span>
      <span>
        {open} {open === 1 ? "rule" : "rules"} in {project.name} where the organization&apos;s and the donor&apos;s policies conflict
      </span>
    </Link>
  );
}

export function Dashboard() {
  const { user, money } = useRequireUser();
  const { project: current } = useCurrentProject();
  const { t, date } = useT();
  const [viewing, setViewing] = useState<string | null>(null);
  // Staff on a database project get the role view (RoleHome), which reads its own data in one
  // request. The field records, review queue and purchases below feed the older panels: a donor's
  // Home, a demo project kept in the browser, and a manager looking at a direct report's work.
  // Nobody else needs them, so nobody else waits for them.
  const olderPanels = !!user && (user.kind !== "employee" || !current.saved || !!viewing);
  const { items: field } = useFieldData(current.id, olderPanels);
  const { submissions } = useSubmissions(current.id, olderPanels);
  const { items: procs } = useProcurements(current.id, olderPanels);
  const plan = usePlan(current.saved ? current.id : null);
  const closeouts = useCloseouts(current.saved && procRolesFor(user).includes("finance") ? current.id : null);
  const [local] = usePersistentState<ProjectState>(PROJECT_KEY, seedProject);
  // Review-queue records live in the database; the rest of the project state is still in this browser.
  const project: ProjectState = { ...local, submissions };
  const [grapes] = usePersistentState<ProjectState>(GATED_KEYS["AG-2027"].key, GATED_KEYS["AG-2027"].seed);
  const stage = useProjectStage(current);

  // /home?view=farida shows a direct report's work, read-only.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v) setViewing(v);
  }, []);
  const view = (id: string | null) => {
    setViewing(id);
    history.replaceState(null, "", id ? `/home?view=${id}` : "/home");
    window.scrollTo({ top: 0 });
  };

  if (!user) return null;
  // Field work and the sample sign-offs belong to the demo project; the calendar to projects with a budget.
  const demo = current.id === "A-2027";
  const data: Data = { field: current.workflows.includes("field") ? field : [], procs, project, stages: { "AG-2027": grapes.stage }, plan: plan.items, closeouts: closeouts.months, sampleSignOffs: demo };
  // Managers may view anyone in their reporting line, not just direct reports, when they drill down.
  const inLine = (id: string): boolean => {
    let m = userById(id);
    while (m?.reportsTo) {
      if (m.reportsTo === user.id) return true;
      m = userById(m.reportsTo);
    }
    return false;
  };
  const subject = viewing && inLine(viewing) ? userById(viewing)! : user;
  const readOnly = subject.id !== user.id;
  const open = procs.filter((p) => p.step !== DONE);
  // HR and payroll role holders: their Home is the People view on every project.
  const hrStaff = user.kind === "employee" && (holdsType(user.id, "hr") || holdsType(user.id, "payroll"));

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-[1400px] space-y-8 px-4 py-8 sm:px-6">
        {readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ochre/40 bg-ochre-soft px-5 py-3 text-sm">
            <p>
              Viewing <span className="font-semibold">{subject.name}</span>&rsquo;s work, read-only. {subject.reportsTo && subject.reportsTo !== user.id ? `Reports to ${userById(subject.reportsTo)?.name}.` : "Reports to you."}
            </p>
            <button type="button" onClick={() => view(subject.reportsTo && subject.reportsTo !== user.id ? subject.reportsTo : null)} className="font-semibold text-warn hover:underline">
              ← Back
            </button>
          </div>
        )}
        <header className="flex flex-wrap items-center gap-4">
          <Initials name={subject.name} className="h-14 w-14 text-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{date(today(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {onDemoClock() && " · demo date"}
            </p>
            <h1 className="font-display text-4xl tracking-tight">{readOnly ? subject.name : t(user.kind === "donor" ? "home.greetingDonor" : "home.greeting", { name: user.name.split(" ")[0] })}</h1>
            <p className="text-sm text-muted">
              {subject.title} · {subject.org}
              {subject.reportsTo && !readOnly ? ` · reports to ${userById(subject.reportsTo)?.name}` : ""}
            </p>
          </div>
          {!readOnly && !current.saved && user.kind === "employee" && user.procurementAccess !== "none" && (
            <p className="basis-full text-sm text-muted sm:basis-auto">
              {open.length} open procurements · <span className="tabular-nums">{money(open.reduce((s, p) => s + valueOf(p), 0))}</span>
            </p>
          )}
        </header>
        {!readOnly && user.admin && <RulesConflicts />}
        {!readOnly && user.kind === "employee" && <FirstSteps />}
        {user.kind === "donor" ? (
          <DonorHome field={field} project={project} />
        ) : readOnly ? (
          <EmployeeHome u={subject} data={data} viewer={user} readOnly={readOnly} onView={(id) => view(id)} />
        ) : (
          <>
            {/* Database projects get the role view first: where things stand, what needs you, what is in season. */}
            {current.saved && user.kind === "employee" && <RoleHome user={user} project={current} />}
            {/* HR's view is about the organization's people, not a project: the same on every project. */}
            {!current.saved && hrStaff && <HrHome userId={user.id} />}
            {/* The person's own HR items (timesheet, leave, expenses) come after the project view. */}
            <PeopleCard />
            {/* The role view covers a database project; the older panels serve the demo projects. */}
            {!current.saved && !hrStaff && <HomePanels user={user} project={current} stage={stage} />}
            {!current.saved && !hrStaff && <Team u={user} data={data} viewer={user} onView={(id) => view(id)} />}
          </>
        )}
      </main>
    </div>
  );
}
