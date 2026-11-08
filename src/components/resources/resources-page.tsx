"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";
import { DIRTY_DOZEN, GUIDES, NET_INCOME_FLOOR, VIABILITY_TESTS } from "@/lib/resources";
import { TEMPLATE_CSV } from "@/lib/results-import";

/** The resource library: ROP's guides, templates, the viability check and the Dirty Dozen. */

const TABS = ["craft", "viability", "dirty-dozen", "templates"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, "resources.craft" | "resources.viability" | "resources.dirtyDozen" | "resources.templates"> = { craft: "resources.craft", viability: "resources.viability", "dirty-dozen": "resources.dirtyDozen", templates: "resources.templates" };
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base tabular-nums";
const num = (s: string) => Number(s.replace(/,/g, "")) || 0;

function Viability() {
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [f, setF] = useState({ now: "", yieldKg: "", price: "", costs: "" });
  const now = num(f.now);
  const revenue = num(f.yieldKg) * num(f.price);
  const net = revenue - num(f.costs);
  const lift = now > 0 ? (net - now) / now : null;
  const passes = VIABILITY_TESTS.filter((x) => ticks[x.id]).length;
  return (
    <div>
      <p className="text-sm text-muted">Before an intervention goes into a design: the tests from the Dirty Dozen, and the farmer&rsquo;s pro forma against the 50% net-income floor. Nothing is saved; use it in the match call or the lens review.</p>
      <ul className="mt-4 space-y-2">
        {VIABILITY_TESTS.map((x) => (
          <li key={x.id}>
            <label className="flex gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-1" checked={!!ticks[x.id]} onChange={(e) => setTicks({ ...ticks, [x.id]: e.target.checked })} />
              <span>
                <span className="font-semibold">{x.label}</span>
                <span className="block text-xs text-muted">{x.why}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
        <h3 className="font-display text-lg">Pro forma for one farmer, per season</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Net income now
            <input inputMode="decimal" className={input} value={f.now} onChange={(e) => setF({ ...f, now: e.target.value })} />
          </label>
          <label className="text-sm">
            Expected sales (kg)
            <input inputMode="decimal" className={input} value={f.yieldKg} onChange={(e) => setF({ ...f, yieldKg: e.target.value })} />
          </label>
          <label className="text-sm">
            Price per kg from the verified buyer
            <input inputMode="decimal" className={input} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </label>
          <label className="text-sm">
            The farmer&rsquo;s costs, their own capital included
            <input inputMode="decimal" className={input} value={f.costs} onChange={(e) => setF({ ...f, costs: e.target.value })} />
          </label>
        </div>
        {revenue > 0 && (
          <p className={`mt-3 text-sm ${lift !== null && lift >= NET_INCOME_FLOOR ? "text-forest" : "text-clay"}`}>
            Sales {revenue.toLocaleString("en-US")}, net {net.toLocaleString("en-US")}
            {lift !== null ? `: ${Math.round(lift * 100)}% ${lift >= 0 ? "above" : "below"} today, ${lift >= NET_INCOME_FLOOR ? "above" : "below"} the 50% floor.` : ". Enter today's net income to compare."}
          </p>
        )}
      </section>
      <p className="mt-4 text-sm">
        {passes} of {VIABILITY_TESTS.length} tests met{lift !== null && revenue > 0 ? `; the pro forma ${lift >= NET_INCOME_FLOOR ? "clears" : "does not clear"} the floor` : ""}.
      </p>
    </div>
  );
}

export function ResourcesPage() {
  const { user } = useRequireUser();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("craft");
  if (!user) return null;
  const groups = ["Wrong thinking", "Wrong work", "Wrong accountability"] as const;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">{t("resources.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("resources.intro")}</p>
        <div role="tablist" aria-label={t("resources.title")} className="mt-6 flex flex-wrap gap-2">
          {TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${tab === x ? "bg-forest text-paper" : "bg-mist text-forest hover:bg-sunken"}`}>
              {t(LABEL[x])}
            </button>
          ))}
        </div>
        <section role="tabpanel" className="mt-6">
          {tab === "craft" && (
            <ul className="space-y-3">
              {GUIDES.map((g) => (
                <li key={g.title}>
                  <a href={g.href} target="_blank" rel="noreferrer" className="block rounded-2xl border border-line bg-surface p-4 hover:border-forest">
                    <span className="font-semibold">{g.title} ↗</span>
                    <span className="mt-1 block text-sm text-muted">{g.what}</span>
                  </a>
                </li>
              ))}
              <li className="text-xs text-muted">Opens in ROP&rsquo;s SharePoint; sign in with your ROP account.</li>
            </ul>
          )}
          {tab === "viability" && <Viability />}
          {tab === "dirty-dozen" && (
            <div>
              <p className="text-sm text-muted">
                Twelve patterns that make agricultural development fail, in three groups of four. In brief here;{" "}
                <a href={GUIDES[1].href} target="_blank" rel="noreferrer" className="font-semibold text-forest hover:underline">
                  read the full document
                </a>{" "}
                for the field examples, ROP&rsquo;s own included.
              </p>
              {groups.map((g) => (
                <section key={g} className="mt-5">
                  <h2 className="font-display text-xl">{g}</h2>
                  <ol className="mt-2 space-y-2">
                    {DIRTY_DOZEN.filter((p) => p.group === g).map((p) => (
                      <li key={p.n} className="rounded-xl border border-line bg-surface p-3 text-sm">
                        <p className="font-semibold">
                          {p.n}. {p.name}
                        </p>
                        <p className="text-muted">{p.looksLike}</p>
                        <p className="mt-1">
                          <span className="font-semibold text-forest">ROP instead: </span>
                          {p.instead}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
          {tab === "templates" && (
            <ul className="space-y-3 text-sm">
              <li className="rounded-2xl border border-line bg-surface p-4">
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`} download="results-template.csv" className="font-semibold text-forest hover:underline">
                  Results import template (CSV)
                </a>
                <span className="mt-1 block text-muted">One row per result, for importing a backlog on the Results page.</span>
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4">
                <Link href="/progress/report" className="font-semibold text-forest hover:underline">
                  Quarterly, annual and final donor reports
                </Link>
                <span className="mt-1 block text-muted">Built from the project&rsquo;s records and downloaded as Word, in ROP&rsquo;s UNDP format.</span>
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4">
                <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
                  Procurement documents
                </Link>
                <span className="mt-1 block text-muted">Requisition, RFQ, solicitation, sole source justification and payment forms, drafted from each procurement record under the April 2025 policy.</span>
              </li>
              <li className="rounded-2xl border border-line bg-surface p-4">
                <span className="font-semibold">BambooHR report for moving staff</span>
                <span className="mt-1 block text-muted">First Name, Last Name, Job Title, Location, Employment Status, Hire Date, Reports To, Pay Rate, Pay Per, Mobile Phone, Contract End Date.</span>
              </li>
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
