"use client";

import { useCloseouts, usePlan, useProcurements } from "@/components/app/use-project-data";

import Link from "next/link";
import { useEffect, useState } from "react";
import { stageOf } from "@/components/field/workspace";
import { useFieldData, useSubmissions } from "@/components/app/use-project-data";
import { PROJECT_KEY } from "@/components/project/project-page";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { Initials, useRequireUser, useSession } from "@/components/app/session";
import { HomePanels } from "@/components/home/panels";
import { Pill, SectionLabel, TODAY, TopBar, usePersistentState } from "@/components/workspace/ui";
import { workFor, type Data, type WorkCard } from "@/components/tasks/work";
import { PROJECT, daysFrom, directReports, userById, type AppUser } from "@/lib/demo";
import { PACKAGE, PACKAGE_USD, farmerName, farmerStages, fieldRoleLabel, maskName, type Farmer, type FieldItem } from "@/lib/field";
import { DONE, roleLabel, valueOf } from "@/lib/procurement";
import { GATED_KEYS, seedProject, type ProjectState } from "@/lib/project";

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
      const d = daysFrom(TODAY, c.date);
      return d <= b.max && (k === 0 || d > buckets[k - 1].max);
    }),
  }));
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {grouped.map((g) => (
        <div key={g.label} className="min-w-0 rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between px-1">
            <p className="text-sm font-semibold">{g.label}</p>
            <p className="font-display text-xl tabular-nums text-muted">{g.cards.length}</p>
          </div>
          <ul className="mt-2 space-y-2">
            {g.cards.map((c) => (
              <li key={c.key}>
                <Link
                  href={c.href}
                  className={`block rounded-xl border px-3 py-2 transition hover:border-forest ${c.late ? "border-clay/50 bg-clay-soft/50" : c.now ? "border-forest/40 bg-mist/60" : "border-dashed border-line bg-paper"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{c.space}</span>
                    <span className={`font-mono text-[11px] ${c.late ? "text-clay" : c.now ? "text-forest" : "text-ochre"}`}>
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
    ...u.project.map((r) => ({ "plan-approver": "Plan approver", "monthly-review": "Monthly review", "report-release": "Report release", "mel-owner": "MEL owner", "finance-import": "NetSuite import" })[r]),
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
          const soon = cards.filter((c) => !c.now && daysFrom(TODAY, c.date) <= 13);
          const sub = directReports(m.id).length;
          return (
            <li key={m.id}>
              <button type="button" onClick={() => onView(m.id)} className="w-full rounded-2xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-forest">
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
                      <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
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
  const soon = cards.filter((c) => !c.now && daysFrom(TODAY, c.date) <= 13);
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
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

function DonorHome({ field, project }: { field: FieldItem[]; project: ProjectState }) {
  const { money, user } = useSession();
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
          ["Received inputs", `${supplied.length} · ${money(supplied.length * PACKAGE_USD)}`],
          ["Average satisfaction", `${avg.toFixed(1)} / 5`],
          ["Success stories", String(stories.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{v}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
        <div>
          <p className="font-semibold">March progress report</p>
          <p className="text-sm text-muted">
            {project.reportRelease ? `Released by ${userById(project.reportRelease.by)?.name} on ${project.reportRelease.date}. Click any number to see its evidence.` : "Not released yet. You will see it here once Roots of Peace signs it off."}
          </p>
        </div>
        {project.reportRelease && (
          <Link href="/progress" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-forest-ink">
            Read the report
          </Link>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>
            {PROJECT.name} · {PROJECT.season}
          </SectionLabel>
          <Link href="/tasks?source=field" className="text-sm font-semibold text-forest hover:underline">
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
        <p className="mt-3 text-xs text-muted">
          Inputs per farmer: {PACKAGE.map((p) => `${p.qty} ${p.unit} ${p.item.toLowerCase()}`).join(" and ")} ({money(PACKAGE_USD)}). Participants are shown by farmer ID.
        </p>
      </section>

      <section>
        <SectionLabel>Success stories</SectionLabel>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {stories.map((s) => (
            <article key={s.id + s.farmer.id} className="rounded-2xl border border-forest/30 bg-mist p-5">
              <p className="font-display text-2xl leading-snug text-forest">{s.title}</p>
              <p className="mt-2 leading-relaxed">{maskName(s.text, s.farmer, user)}</p>
              <Link href={`/field/farmers/${s.farmer.id}`} className="mt-3 inline-block text-sm font-semibold text-forest hover:underline">
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

export function Dashboard() {
  const { user, money } = useRequireUser();
  const { project: current } = useCurrentProject();
  const { t, date } = useT();
  const { items: field } = useFieldData(current.id);
  const { submissions } = useSubmissions(current.id);
  const { items: procs } = useProcurements(current.id);
  const plan = usePlan(current.saved ? current.id : null);
  const closeouts = useCloseouts(current.saved && user?.procurement.includes("finance") ? current.id : null);
  const [local] = usePersistentState<ProjectState>(PROJECT_KEY, seedProject);
  // Review-queue records live in the database; the rest of the project state is still in this browser.
  const project: ProjectState = { ...local, submissions };
  const [grapes] = usePersistentState<ProjectState>(GATED_KEYS["AG-2027"].key, GATED_KEYS["AG-2027"].seed);
  const [viewing, setViewing] = useState<string | null>(null);

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
  const demo = current.workflows.includes("field");
  const data: Data = { field: demo ? field : [], procs, project, stages: { "AG-2027": grapes.stage }, plan: plan.items, closeouts: closeouts.months, sampleSignOffs: demo };
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

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-[1400px] space-y-8 px-4 py-8 sm:px-6">
        {readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ochre/40 bg-ochre-soft px-5 py-3 text-sm">
            <p>
              Viewing <span className="font-semibold">{subject.name}</span>&rsquo;s work, read-only. {subject.reportsTo && subject.reportsTo !== user.id ? `Reports to ${userById(subject.reportsTo)?.name}.` : "Reports to you."}
            </p>
            <button type="button" onClick={() => view(subject.reportsTo && subject.reportsTo !== user.id ? subject.reportsTo : null)} className="font-semibold text-ochre hover:underline">
              ← Back
            </button>
          </div>
        )}
        <header className="flex flex-wrap items-center gap-4">
          <Initials name={subject.name} className="h-14 w-14 text-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{date(TODAY, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · demo date</p>
            <h1 className="font-display text-4xl tracking-tight">{readOnly ? subject.name : t("home.greeting", { name: user.name.split(" ")[0] })}</h1>
            <p className="text-sm text-muted">
              {subject.title} · {subject.org}
              {subject.reportsTo && !readOnly ? ` · reports to ${userById(subject.reportsTo)?.name}` : ""}
            </p>
          </div>
          {!readOnly && user.kind === "employee" && user.procurementAccess !== "none" && (
            <p className="basis-full text-sm text-muted sm:basis-auto">
              {open.length} open procurements · <span className="tabular-nums">{money(open.reduce((s, p) => s + valueOf(p), 0))}</span>
            </p>
          )}
        </header>
        {user.kind === "donor" ? (
          <DonorHome field={field} project={project} />
        ) : readOnly ? (
          <EmployeeHome u={subject} data={data} viewer={user} readOnly={readOnly} onView={(id) => view(id)} />
        ) : (
          <>
            <HomePanels user={user} project={current} stage={(current.id === "A-2027" ? local.stage : current.id === "AG-2027" ? grapes.stage : undefined) ?? current.stage} />
            <Team u={user} data={data} viewer={user} onView={(id) => view(id)} />
          </>
        )}
      </main>
    </div>
  );
}
