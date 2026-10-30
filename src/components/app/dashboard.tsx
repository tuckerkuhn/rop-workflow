"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { comingTo, stageOf } from "@/components/field/workspace";
import { useFieldData, useSubmissions } from "@/components/app/use-project-data";
import { PROCUREMENT_ITEMS_KEY, procurementComingTo } from "@/components/procurement/workspace";
import { PROJECT_KEY } from "@/components/project/project-page";
import { Initials, useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TODAY, TopBar, usePersistentState } from "@/components/workspace/ui";
import { PROJECT, daysFrom, directReports, projectPath, projects, stepHistory, userById, type AppUser, type Stage } from "@/lib/demo";
import { PACKAGE, PACKAGE_USD, farmerLabel, farmerName, farmerStages, fieldRoleLabel, fieldSteps, maskName, ownerOfItem, projectItem, type Farmer, type FieldItem } from "@/lib/field";
import { DONE, ownerOf, roleLabel, seedProcurements, stepById, stepsFor, valueOf, type Procurement } from "@/lib/procurement";
import { GATED_KEYS, indicators, actualFor, seedProject, type ProjectState } from "@/lib/project";

type Space = "Project" | "Field" | "Procurement";
type WorkCard = { key: string; title: string; step: string; date: string; href: string; space: Space; now: boolean; late: boolean; note: string };
type Data = { field: FieldItem[]; procs: Procurement[]; project: ProjectState; stages: Record<string, Stage | undefined> };

function weekday(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function permissions(u: AppUser) {
  return {
    field: { view: u.fieldAccess !== "none", edit: u.field.length > 0, create: u.field.includes("mel") ? "New MEL finding" : null },
    procurement: { view: u.procurementAccess !== "none", edit: u.procurement.length > 0, create: u.procurement.includes("holder") ? "New purchase request" : null },
  };
}

const lastDate = (t: { date: string }[]) => (t.length ? t[t.length - 1].date : TODAY);
const isLate = (step: string, since: string) => daysFrom(since, TODAY) > (stepHistory[step]?.median ?? 3);

/** Everything on one person's plate: workflow steps they hold, project sign-offs, and what is projected to reach them. */
function workFor(u: AppUser, { field, procs, project }: Data, viewer: AppUser): WorkCard[] {
  const cards: WorkCard[] = [];
  for (const r of u.field) {
    field
      .filter((i) => ownerOfItem(i) === r)
      .forEach((i) => {
        const since = lastDate(i.timeline);
        cards.push({
          key: `f-${i.id}`,
          title: i.kind === "farmer" ? farmerLabel(i, viewer) : i.title,
          step: fieldSteps[i.step].title,
          date: projectItem(i)[0]?.end ?? TODAY,
          href: `/field?open=${i.id}`,
          space: "Field",
          now: true,
          late: isLate(i.step, since),
          note: "",
        });
      });
    comingTo(field, r, viewer).forEach((c) =>
      cards.push({ key: `fc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/field?open=${c.id}`, space: "Field", now: false, late: false, note: `Now ${c.via}` }),
    );
  }
  for (const r of u.procurement) {
    procs
      .filter((p) => ownerOf(p) === r)
      .forEach((p) => {
        const list = stepsFor(p);
        const i = list.findIndex((s) => s.id === p.step);
        const since = lastDate(p.timeline);
        const path = projectPath(
          list.slice(i).map((s) => ({ step: s.id, owner: s.owner })),
          since,
          TODAY,
        );
        cards.push({
          key: `p-${p.id}`,
          title: `${p.title} · ${p.id}`,
          step: stepById[p.step].title,
          date: path[0]?.end ?? TODAY,
          href: `/procurement?open=${p.id}`,
          space: "Procurement",
          now: true,
          late: isLate(p.step, since),
          note: "",
        });
      });
    procurementComingTo(procs, r).forEach((c) =>
      cards.push({ key: `pc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/procurement?open=${c.id}`, space: "Procurement", now: false, late: false, note: `Now ${c.via}` }),
    );
  }
  // Project sign-offs from the build spec.
  const pending = project.submissions.filter((s) => s.status === "pending").length;
  const unapproved = indicators.filter((i) => {
    if (i.source === "survey") return false;
    const a = project.actualApprovals[i.id];
    return !a || a.note !== String(actualFor(i, project.submissions).value);
  }).length;
  const proj = (key: string, title: string, step: string, tab: string, days: number) =>
    cards.push({ key, title, step, date: new Date(Date.parse(TODAY) + days * 86400000).toISOString().slice(0, 10), href: `/projects/${PROJECT.id}#${tab}`, space: "Project", now: true, late: false, note: "" });
  if (u.project.includes("mel-owner")) {
    if (pending) proj("pj-queue", `${pending} Kobo submissions to review`, "Accept or query in the review queue", "verify", 1);
    if (unapproved) proj("pj-actuals", `${unapproved} actuals to approve`, "Approve this period's actuals", "verify", 3);
  }
  if (u.project.includes("finance-import") && !project.importedOn) proj("pj-import", "March NetSuite export", "Import and map spend to budget lines", "budget", 2);
  if (u.project.includes("monthly-review")) {
    const open = project.changes.filter((c) => c.status === "proposed").length;
    if (open) proj("pj-review", `${open} proposed changes`, "Decide in the monthly review", "overview", 4);
  }
  if (u.project.includes("report-release") && !project.reportRelease) proj("pj-report", "March progress report", "Review and release", "report", 7);
  return cards.sort((a, b) => a.date.localeCompare(b.date));
}

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
  const perm = permissions(viewer);
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

      {!readOnly && (
        <section>
          <SectionLabel>Projects and workflows you can use</SectionLabel>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {projects.map((pr) => (
              <article key={pr.id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-muted">
                      {pr.id} · {pr.country} · stage: {data.stages[pr.id] ?? pr.stage}
                    </p>
                    <h3 className="mt-1 font-display text-2xl tracking-tight">{pr.name}</h3>
                  </div>
                  <Pill tone={pr.status === "Active" ? "forest" : "muted"}>{pr.status}</Pill>
                </div>
                <p className="mt-2 text-sm text-muted">{pr.note}</p>
                <Link href={`/projects/${pr.id}`} className="mt-3 inline-block text-sm font-semibold text-forest hover:underline">
                  Open project →
                </Link>
                {pr.workflows.length > 0 && (
                  <ul className="mt-4 divide-y divide-line border-y border-line">
                    {(
                      [
                        { id: "field", label: "Field activities", href: "/field", p: perm.field },
                        { id: "procurement", label: "Procurement", href: "/procurement", p: perm.procurement },
                      ] as const
                    ).map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{w.label}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(["view", "edit"] as const).map((k) => (
                              <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${w.p[k] ? "bg-mist text-leaf" : "bg-sunken text-muted line-through"}`}>
                                {k}
                              </span>
                            ))}
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${w.p.create ? "bg-mist text-leaf" : "bg-sunken text-muted line-through"}`}>create</span>
                          </div>
                        </div>
                        {w.p.view ? (
                          <>
                            {w.p.create && (
                              <Link href={`${w.href}?new=1`} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-forest hover:text-forest">
                                + {w.p.create}
                              </Link>
                            )}
                            <Link href={w.href} className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink">
                              Open
                            </Link>
                          </>
                        ) : (
                          <span className="text-xs text-muted">Not available to your role</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
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
          <Link href={`/projects/${PROJECT.id}#report`} className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-forest-ink">
            Read the report
          </Link>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>
            {PROJECT.name} · {PROJECT.season}
          </SectionLabel>
          <Link href="/field" className="text-sm font-semibold text-forest hover:underline">
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
  const { items: field } = useFieldData();
  const { submissions } = useSubmissions();
  const [procs] = usePersistentState<Procurement[]>(PROCUREMENT_ITEMS_KEY, seedProcurements);
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
  const data: Data = { field, procs, project, stages: { "AG-2027": grapes.stage } };
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
            <p className="text-sm text-muted">{weekday(TODAY)} · demo date</p>
            <h1 className="font-display text-4xl tracking-tight">{readOnly ? subject.name : `Salaam, ${user.name.split(" ")[0]}`}</h1>
            <p className="text-sm text-muted">
              {subject.title} · {subject.org}
              {subject.reportsTo && !readOnly ? ` · reports to ${userById(subject.reportsTo)?.name}` : ""}
            </p>
          </div>
          {!readOnly && user.kind === "employee" && user.procurementAccess !== "none" && (
            <p className="text-sm text-muted">
              {open.length} open procurements · <span className="tabular-nums">{money(open.reduce((s, p) => s + valueOf(p), 0))}</span>
            </p>
          )}
        </header>
        {user.kind === "donor" ? <DonorHome field={field} project={project} /> : <EmployeeHome u={subject} data={data} viewer={user} readOnly={readOnly} onView={(id) => view(id)} />}
      </main>
    </div>
  );
}
