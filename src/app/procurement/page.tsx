import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { ProcurementExplorer } from "@/components/procurement-explorer";
import { Reveal } from "@/components/reveal";
import { StatusTag, Tagged } from "@/components/status-tag";
import { boundaries, caseTypes, decisions, firstSlice, gates, sharedRecords, statusTags } from "@/lib/procurement";

const REPO = "https://github.com/tuckerkuhn/rop-workflow";
const BLUEPRINT = `${REPO}/blob/main/docs/ROP-PROCUREMENT-BLUEPRINT.md`;

export const metadata: Metadata = {
  title: "Procurement · ROP Workflow",
  description:
    "The AI-native procurement workflow reconciled with ROP Procurement Policy Draft 1.0: stages, gates, shared records, and the first prototype slice.",
};

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">{eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 text-lg leading-relaxed text-muted text-pretty">{children}</p>}
    </Reveal>
  );
}

export default function ProcurementPage() {
  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-lg tracking-tight">ROP Workflow</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            <a href="#stages" className="transition hover:text-ink">Stages</a>
            <a href="#gates" className="transition hover:text-ink">Gates</a>
            <a href="#records" className="transition hover:text-ink">Records</a>
            <a href="#slice" className="transition hover:text-ink">First slice</a>
            <Link href="/" className="transition hover:text-ink">Seasonal workflow</Link>
          </nav>
          <a href={BLUEPRINT} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-85">
            Full blueprint
          </a>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-7xl px-5 pb-20 pt-16 sm:px-8 lg:pt-24">
          <p className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-clay" />
            Target-state design · Policy Draft 1.0 is not approved
          </p>
          <h1
            className="rise mt-6 max-w-4xl font-display text-[clamp(2.5rem,5.6vw,4.5rem)] font-[420] leading-[1] tracking-[-0.025em] text-balance"
            style={{ animationDelay: "80ms" }}
          >
            Procurement, from confirmed need to <em className="font-[380] italic text-forest">payment-ready.</em>
          </h1>
          <p className="rise mt-7 max-w-2xl text-lg leading-relaxed text-muted text-pretty" style={{ animationDelay: "160ms" }}>
            The inputs a season distributes are bought here first. One Procurement ID carries each purchase from requisition to
            final payment. Gates stop it where policy says it must stop, and every rule shows where it comes from.
          </p>
          <div className="rise mt-10 rounded-2xl border border-line bg-surface p-5" style={{ animationDelay: "240ms" }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">How to read the tags</p>
            <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {statusTags.map((t) => (
                <div key={t.kind} className="flex gap-3 text-sm">
                  <dt className="w-12 shrink-0">
                    <StatusTag kind={t.kind} />
                  </dt>
                  <dd className="leading-relaxed text-muted">
                    <span className="font-semibold text-ink">{t.label}. </span>
                    {t.meaning}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-line pt-4 text-sm leading-relaxed text-muted">
              Policy status: the source package says the ROP UN Procurement Policy (CBARD) of April 2025 stays in force until
              the CEO approves Draft 1.0 <StatusTag kind="CUR" />. Its own brief also says the October 2022 policy stays filed as
              in force, so which policy governs a given purchase today is still unsettled <StatusTag kind="OPEN" />.
            </p>
          </div>
        </section>

        {/* Stages */}
        <section id="stages" className="border-t border-line bg-sunken">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
            <SectionHeading eyebrow="Lifecycle" title="Eight stages, plus the award they inherit from.">
              Programme start-up sets the rulebook once per award. Select any stage to see who acts, what AI and automation
              do, who decides, and what is still open.
            </SectionHeading>
            <Reveal className="mt-14">
              <ProcurementExplorer />
            </Reveal>
          </div>
        </section>

        {/* Gates */}
        <section id="gates" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <SectionHeading eyebrow="Control spine" title="Six points where nothing moves on.">
            Automation enforces these gates. People record what satisfies them. Because the rules are draft, each one is a
            configurable rule labelled with its source.
          </SectionHeading>
          <Reveal className="mt-14 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line bg-paper text-[11px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Gate</th>
                  <th className="px-5 py-3 font-semibold">Blocks</th>
                  <th className="px-5 py-3 font-semibold">Conditions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {gates.map((g) => (
                  <tr key={g.id} className="align-top">
                    <td className="px-5 py-4">
                      <span className="mr-3 inline-grid h-7 min-w-7 place-items-center rounded-md bg-ochre-soft px-1 font-mono text-xs font-semibold text-ochre">
                        {g.id}
                      </span>
                      <span className="font-semibold">{g.name}</span>
                    </td>
                    <td className="px-5 py-4 text-muted">{g.blocks}</td>
                    <td className="px-5 py-4 leading-relaxed">
                      <Tagged text={g.conditions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
        </section>

        {/* Shared records + cases */}
        <section id="records" className="bg-deep text-deep-ink">
          <div className="mx-auto grid max-w-7xl gap-16 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:py-32">
            <div>
              <Reveal className="max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">Shared records</p>
                <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance">
                  One Procurement ID on every document.
                </h2>
                <p className="mt-5 leading-relaxed opacity-75">
                  The same budget lines, activities and evidence the seasonal workflow uses. Facts are recorded once at their
                  source and linked, not copied.
                </p>
              </Reveal>
              <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-deep-ink/15 sm:grid-cols-2">
                {sharedRecords.map((r) => (
                  <li key={r.name} className="bg-deep p-5">
                    <p className="font-display text-lg">{r.name}</p>
                    <p className="mt-1 text-sm opacity-65">{r.note}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Reveal className="max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">Exceptions</p>
                <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-balance">
                  One queue, typed cases, two kept out.
                </h2>
                <p className="mt-5 leading-relaxed opacity-75">
                  Policy treats these differently, so each case carries its type. Protests and integrity reports never enter
                  the shared queue.
                </p>
              </Reveal>
              <ul className="mt-10 divide-y divide-deep-ink/15 border-y border-deep-ink/15">
                {caseTypes.map((c) => (
                  <li key={c.type} className="grid grid-cols-[1fr_auto] items-start gap-4 py-4">
                    <div>
                      <p className="font-semibold">{c.type}</p>
                      <p className="mt-1 text-sm leading-relaxed opacity-70">{c.route.replace(/\s*\[[^\]]*\]/g, "")}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        c.shared ? "bg-deep-ink/10" : "bg-ochre text-[#1b140a]"
                      }`}
                    >
                      {c.shared ? "Shared queue" : "Outside"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Boundaries */}
        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <SectionHeading eyebrow="Decision boundaries" title="AI prepares the checks. People make them.">
            The two reviews that actually catch errors stay human: the Home Office solicitation review and the contract
            conformity check. AI runs them first so reviewers spend less time.
          </SectionHeading>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {boundaries.map((b, i) => (
              <Reveal key={b.who} delay={i * 90} className="rounded-3xl border border-line bg-surface p-8">
                <h3 className="font-display text-2xl tracking-tight">{b.who}</h3>
                <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-leaf">Does</p>
                <p className="mt-2 text-[0.95rem] leading-relaxed">{b.does}</p>
                <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-clay">Never</p>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">
                  <Tagged text={b.never} />
                </p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* First slice */}
        <section id="slice" className="border-t border-line bg-sunken">
          <div className="mx-auto grid max-w-7xl gap-16 px-5 py-24 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-32">
            <div>
              <SectionHeading eyebrow="Proposed first slice" title="Replay a real file before building a live one.">
                <Tagged text={firstSlice.summary} />
              </SectionHeading>
              <ul className="mt-10 space-y-4">
                {firstSlice.why.map((w) => (
                  <li key={w} className="grid grid-cols-[1.25rem_1fr] gap-3 leading-relaxed">
                    <span aria-hidden className="mt-2.5 h-1.5 w-1.5 rounded-full bg-forest" />
                    <span>
                      <Tagged text={w} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 self-start">
              {[
                { title: "Simulated", items: firstSlice.simulated, tone: "text-plum" },
                { title: "Integrated, read-only", items: firstSlice.integrated, tone: "text-leaf" },
                { title: "Out of scope", items: firstSlice.outOfScope, tone: "text-clay" },
              ].map((g) => (
                <Reveal key={g.title} className="rounded-2xl border border-line bg-surface p-6">
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${g.tone}`}>{g.title}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.items.map((it) => (
                      <span key={it} className="rounded-md border border-line bg-paper px-2 py-1 text-sm">
                        {it}
                      </span>
                    ))}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Decisions */}
        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.4fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeading eyebrow="Before building" title="Seven decisions that change the design.">
                Each one changes the data model, a gate, or what the prototype covers. Everything else stays configurable.
              </SectionHeading>
            </div>
            <ol className="divide-y divide-line border-y border-line">
              {decisions.map((d, i) => (
                <Reveal as="li" key={d.q} className="grid grid-cols-[3rem_1fr] gap-4 py-6">
                  <span className="font-mono text-sm text-ochre">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="font-display text-xl leading-snug tracking-tight">{d.q}</p>
                    <p className="mt-2 text-sm text-muted">Owner: {d.owner}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-6 w-6" />
            <span>ROP Workflow · open source under MIT</span>
          </div>
          <p>
            Design only. Nothing here is approved policy. <a href={BLUEPRINT} className="underline underline-offset-4 hover:text-ink">Read the full blueprint</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
