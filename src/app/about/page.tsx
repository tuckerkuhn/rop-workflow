import Link from "next/link";
import { FarmerCard } from "@/components/farmer-card";
import { LogoMark } from "@/components/logo";
import { Reveal } from "@/components/reveal";
import { WorkflowExplorer } from "@/components/workflow-explorer";
import { lifecycle, principles } from "@/lib/workflow";

const REPO = "https://github.com/tuckerkuhn/rop-workflow";

const metrics = [
  { value: "85%", label: "of plots passed readiness on the first visit", note: "17 of 20" },
  { value: "2 / 3", label: "failed plots corrected before the deadline", note: "rechecked in 7 days" },
  { value: "100%", label: "of input packages linked to expenditure evidence", note: "budget line 2.1" },
  { value: "1", label: "management action assigned with owner and date", note: "feeds next season" },
];

function FieldRows() {
  const rows = Array.from({ length: 16 }, (_, i) => {
    const y = 60 + i * 38;
    return `M -40 ${y} C 260 ${y - 70 + i * 2}, 620 ${y + 70 - i * 3}, 1240 ${y - 30}`;
  });
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      className="draw pointer-events-none absolute inset-0 h-full w-full text-forest [mask-image:radial-gradient(ellipse_at_70%_40%,black_20%,transparent_75%)]"
    >
      {rows.map((d, i) => (
        <path key={i} d={d} pathLength={1} fill="none" stroke="currentColor" strokeOpacity={0.1 + (i % 4) * 0.025} strokeWidth="1" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </svg>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">{eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 text-lg leading-relaxed text-muted text-pretty">{children}</p>}
    </Reveal>
  );
}

export const metadata = {
  title: "About · ROP Workflow",
  description: "What the ROP Workflow prototype is, how it works, and the rules behind it.",
};

export default function About() {
  return (
    <div className="overflow-x-clip">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-lg tracking-tight">ROP Workflow</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            <a href="#workflow" className="transition hover:text-ink">Workflow</a>
            <a href="#lifecycle" className="transition hover:text-ink">Lifecycle</a>
            <a href="#principles" className="transition hover:text-ink">Principles</a>
            <a href="#platform" className="transition hover:text-ink">Platform</a>
            <Link href="/procurement" className="transition hover:text-ink">Procurement</Link>
          </nav>
          <Link href="/" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-85">
            Open the app
          </Link>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative">
          <FieldRows />
          <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-5 pb-24 pt-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-32 lg:pt-24">
            <div>
              <p className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ochre" />
                Prototype · synthetic data only
              </p>
              <h1
                className="rise mt-6 font-display text-[clamp(2.75rem,6.4vw,5.25rem)] font-[420] leading-[0.98] tracking-[-0.025em] text-balance"
                style={{ animationDelay: "80ms" }}
              >
                From prepared field to <em className="font-[380] italic text-forest">proven result.</em>
              </h1>
              <p className="rise mt-7 max-w-xl text-lg leading-relaxed text-muted text-pretty" style={{ animationDelay: "160ms" }}>
                One shared record for agricultural development projects: farmers, plots, readiness, inputs,
                evidence, and the decisions that follow. Every season answers three questions. Is this farmer
                ready? What happened? What needs action, who owns it, and by when?
              </p>
              <div className="rise mt-10 flex flex-wrap items-center gap-3" style={{ animationDelay: "240ms" }}>
                <a
                  href="#workflow"
                  className="group inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3.5 text-sm font-medium text-forest-ink shadow-[0_14px_30px_-14px_rgb(31_77_54/0.8)] transition hover:-translate-y-0.5"
                >
                  Explore the workflow
                  <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
                </a>
                <a href="#platform" className="rounded-full border border-line bg-surface/60 px-6 py-3.5 text-sm font-medium transition hover:border-ink/30">
                  How it works
                </a>
              </div>
              <dl className="rise mt-14 flex flex-wrap gap-x-10 gap-y-4 text-sm" style={{ animationDelay: "320ms" }}>
                {[
                  ["Works offline", "KoboToolbox in the field"],
                  ["Paper counts", "as source evidence"],
                  ["Open source", "MIT licensed"],
                ].map(([t, d]) => (
                  <div key={t}>
                    <dt className="font-semibold">{t}</dt>
                    <dd className="text-muted">{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rise lg:pl-6" style={{ animationDelay: "300ms" }}>
              <FarmerCard />
            </div>
          </div>
        </section>

        {/* Metrics */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                Synthetic pilot season · 20 fictional farmers
              </p>
            </Reveal>
            <div className="mt-8 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-line">
              {metrics.map((m, i) => (
                <Reveal key={m.label} delay={i * 90} className="lg:px-8 lg:first:pl-0">
                  <p className="font-display text-5xl tracking-tight text-forest">{m.value}</p>
                  <p className="mt-3 text-sm leading-relaxed">{m.label}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted">{m.note}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" className="mx-auto max-w-7xl px-5 py-28 sm:px-8 lg:py-36">
          <SectionHeading eyebrow="The seasonal workflow" title={<>Inputs move only when the field is ready.</>}>
            Seven steps from season plan to management action, with a single yes/no gate at the centre. Select any
            step to see who owns it and what it records.
          </SectionHeading>
          <Reveal className="mt-16">
            <WorkflowExplorer />
          </Reveal>
        </section>

        {/* Procurement */}
        <section className="border-y border-line bg-sunken">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">Connected workflow · Procurement</p>
              <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">
                Before inputs are distributed, they are bought.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted text-pretty">
                The procurement workflow carries each purchase from requisition to payment-ready under one Procurement ID,
                using the same budget lines and evidence as the season. It is reconciled with ROP&rsquo;s Procurement Policy
                Draft 1.0, which is not yet approved.
              </p>
              <Link
                href="/procurement"
                className="group mt-8 inline-flex items-center gap-2 rounded-full bg-forest px-6 py-3.5 text-sm font-medium text-forest-ink transition hover:-translate-y-0.5"
              >
                Open the procurement workspace
                <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
              </Link>
            </Reveal>
            <Reveal delay={120}>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {["Need", "Requisition", "Authorize", "Select", "Contract", "Receive", "Pay-ready", "Close"].map((s, i) => (
                  <li key={s} className="rounded-xl border border-line bg-surface px-3 py-3">
                    <span className="font-mono text-[10px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span className="mt-1 block font-display text-sm">{s}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">Received goods become the input packages at step 5A.</p>
            </Reveal>
          </div>
        </section>

        {/* Lifecycle */}
        <section id="lifecycle" className="bg-deep text-deep-ink">
          <div className="mx-auto max-w-7xl px-5 py-28 sm:px-8 lg:py-36">
            <Reveal className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">Project lifecycle</p>
              <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">
                The whole arc, from opportunity to closeout.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-pretty opacity-75">
                Eight stages, mapped simply. The MVP details the seasonal core, where most of the evidence and most
                of the decisions live.
              </p>
            </Reveal>
            <ol className="mt-16 grid gap-px overflow-hidden rounded-3xl bg-deep-ink/15 sm:grid-cols-2 lg:grid-cols-4">
              {lifecycle.map((s, i) => (
                <Reveal as="li" key={s.title} delay={(i % 4) * 80} className="relative bg-deep p-7">
                  <div className="flex items-start justify-between">
                    <span className="font-display text-5xl italic opacity-40">{i + 1}</span>
                    {s.mvp && (
                      <span className="rounded-full bg-ochre px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#1b140a]">
                        In MVP
                      </span>
                    )}
                  </div>
                  <h3 className="mt-8 font-display text-xl">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed opacity-70">{s.detail}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Principles */}
        <section id="principles" className="mx-auto max-w-7xl px-5 py-28 sm:px-8 lg:py-36">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.4fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeading eyebrow="Evidence rules" title="Record it once. Trace it always.">
                Five rules keep the system honest: fewer duplicate forms, clearer evidence, and decisions that can
                be traced back to the field.
              </SectionHeading>
            </div>
            <ol className="divide-y divide-line border-y border-line">
              {principles.map((p, i) => (
                <Reveal as="li" key={p.title} className="grid grid-cols-[3rem_1fr] gap-4 py-8">
                  <span className="font-mono text-sm text-ochre">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="font-display text-2xl tracking-tight">{p.title}</h3>
                    <p className="mt-3 leading-relaxed text-muted">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Platform */}
        <section id="platform" className="border-t border-line bg-sunken">
          <div className="mx-auto max-w-7xl px-5 py-28 sm:px-8 lg:py-36">
            <SectionHeading eyebrow="Platform" title="Built for the field, not the office.">
              Field teams collect data offline with proven open-source tools. Every submission lands in one linked
              record that MEL and management work from.
            </SectionHeading>
            <div className="mt-16 grid gap-4 lg:grid-cols-3">
              {[
                {
                  step: "Collect",
                  title: "Offline in the field",
                  body: "KoboCollect on Android or Enketo in a browser. Multi-language XLSForms with GPS and photos. Farmer and plot lists ship with each form, so staff pick real IDs instead of typing them.",
                  tags: ["KoboToolbox", "XLSForm", "Enketo"],
                },
                {
                  step: "Connect",
                  title: "Verified and linked",
                  body: "Submissions arrive by authenticated webhook, with a daily sync as backup. Duplicates are ignored, and every record is tied to its farmer, plot, season, and evidence.",
                  tags: ["Webhook", "Daily sync", "Idempotent"],
                },
                {
                  step: "Decide",
                  title: "One shared record",
                  body: "MEL validates findings against source records. Management assigns actions with owners and due dates, and the learning carries into the next season’s plan.",
                  tags: ["Postgres", "MEL review", "Action board"],
                },
              ].map((c, i) => (
                <Reveal key={c.step} delay={i * 100} className="relative rounded-3xl border border-line bg-surface p-8">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-mist font-mono text-xs text-forest">
                      {i + 1}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{c.step}</span>
                  </div>
                  <h3 className="mt-8 font-display text-2xl tracking-tight">{c.title}</h3>
                  <p className="mt-3 text-[0.95rem] leading-relaxed text-muted">{c.body}</p>
                  <div className="mt-8 flex flex-wrap gap-1.5">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] text-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                  {i < 2 && (
                    <span aria-hidden className="absolute -right-[11px] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-[10px] text-muted lg:grid">
                      →
                    </span>
                  )}
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-5 py-28 sm:px-8 lg:py-36">
          <Reveal className="relative overflow-hidden rounded-[2rem] bg-ink px-8 py-16 text-paper sm:px-16 sm:py-20">
            <svg aria-hidden viewBox="0 0 600 300" className="absolute -right-20 -top-10 h-[130%] w-auto text-ochre opacity-20">
              {Array.from({ length: 10 }, (_, i) => (
                <path key={i} d={`M 0 ${40 + i * 26} C 160 ${10 + i * 26}, 380 ${80 + i * 26}, 600 ${30 + i * 26}`} fill="none" stroke="currentColor" />
              ))}
            </svg>
            <div className="relative max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">Next step</p>
              <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">
                Run one fictional farmer through all seven steps.
              </h2>
              <p className="mt-5 text-lg leading-relaxed opacity-70">
                The prototype uses synthetic data only. Each gap it finds shapes the MVP before any real project
                depends on it.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href={REPO} className="rounded-full bg-paper px-6 py-3.5 text-sm font-medium text-ink transition hover:opacity-90">
                  View the code
                </a>
                <a href="#workflow" className="rounded-full border border-paper/25 px-6 py-3.5 text-sm font-medium transition hover:border-paper/60">
                  Back to the workflow
                </a>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-6 w-6" />
            <span>ROP Workflow · open source under MIT</span>
          </div>
          <p>Prototype using synthetic data. No live farmer information.</p>
        </div>
      </footer>
    </div>
  );
}
