"use client";

import { useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { FromDocuments } from "@/components/setup/from-documents";
import { clearPending, getPending } from "@/components/setup/pending";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { deadlinesFrom, reportDaysRule, ruleValue, type Obligation } from "@/lib/agreement";
import { paramByKey, show, type Value } from "@/lib/policy";

/**
 * Setup's Deadlines and Rules steps (lib/agreement): what the agreement says, proposed with the
 * clause it came from, each item kept or left out, saved only when the person confirms. With
 * nothing read yet (a running project, or a reload), the step asks for the agreement first.
 */

async function post(code: string, user: string, body: unknown) {
  const r = await fetch(`/api/projects/${code}/agreement`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
  return d;
}

function Questions({ list }: { list: string[] }) {
  const { t } = useT();
  if (!list.length) return null;
  return (
    <div className="mt-4 rounded-xl bg-ochre-soft px-4 py-3 text-sm">
      <p className="font-semibold">{t("ag.questions")}</p>
      <ul className="mt-1 list-disc ps-5">
        {list.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

const Check = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} aria-label={label} className="mt-0.5 h-5 w-5 shrink-0 accent-forest" />;

export function DeadlinesStep({ code, start, end, onDone }: { code: string; start: string; end: string; onDone: () => void }) {
  const { t, date } = useT();
  const { user } = useSession();
  const [, setTick] = useState(0);
  const terms = getPending().terms;
  const obligations: Obligation[] = useMemo(
    () => (terms?.obligations ?? []).map((o) => ({ ...o, report: o.report.slice(0, 160), daysAfterPeriod: o.daysAfterPeriod === null ? null : Math.max(0, Math.round(o.daysAfterPeriod)), dueDates: o.dueDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) })),
    [terms],
  );
  const proposed = useMemo(() => obligations.map((o) => deadlinesFrom(o, start, end)), [obligations, start, end]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const kept = proposed.flatMap((list) => list.filter((d) => !off.has(`${d.title}|${d.date}`)));
  const rules = obligations.map((o) => ({ o, r: reportDaysRule(o) })).filter((x) => x.r && !off.has(`rule:${x.o.report}`));
  const save = async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const d = await post(code, user.id, { action: "deadlines", items: kept, rules: rules.map((x) => ({ key: x.r!.key, value: x.r!.value, source: x.o.source })), file: getPending().termsFile });
      setSaved(d.added);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k: string, on: boolean) => setOff((s) => (on ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <section>
      <h1 className="font-display text-3xl leading-tight tracking-tight">{t("ag.deadlines.title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("ag.deadlines.help")}</p>
      {!terms && user && (
        <div className="mt-4">
          <FromDocuments user={user.id} project={code} onRead={() => setTick((n) => n + 1)} />
        </div>
      )}
      {terms && !obligations.length && <p className="mt-4 text-sm text-muted">{t("ag.deadlines.none")}</p>}
      <div className="mt-4 space-y-4">
        {obligations.map((o, k) => (
          <div key={`${o.report}${k}`} className="rounded-2xl border border-line bg-surface p-4">
            <p className="font-semibold">{o.report}</p>
            <p className="text-xs text-muted">
              {o.daysAfterPeriod !== null ? `${t("ag.deadlines.days", { days: o.daysAfterPeriod })} · ` : ""}
              {o.format ? `${t("ag.deadlines.format", { format: o.format })} · ` : ""}
              {t("ag.source", { source: o.source })}
            </p>
            <ul className="mt-2 space-y-1">
              {proposed[k].map((d) => {
                const key = `${d.title}|${d.date}`;
                return (
                  <li key={key}>
                    <label className="flex min-h-10 items-start gap-3 text-sm">
                      <Check on={!off.has(key)} set={(v) => toggle(key, v)} label={`${d.title}, ${d.date}`} />
                      <span>
                        <span className="tabular-nums">{date(d.date, { day: "numeric", month: "short", year: "numeric" })}</span> · {d.title}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Questions list={terms?.questions ?? []} />
      {error && <p className="mt-3 text-sm text-clay">{error}</p>}
      {saved !== null && <p className="mt-3 text-sm text-leaf">{t("ag.deadlines.saved", { n: saved })}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {kept.length > 0 && saved === null && (
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>
            {t("ag.deadlines.save", { n: kept.length })}
          </button>
        )}
        <button type="button" className={quietBtn} onClick={onDone}>
          {saved !== null ? t("plan.continue") : t("ag.skip")}
        </button>
      </div>
    </section>
  );
}

export function RulesStep({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useT();
  const { user } = useSession();
  const [, setTick] = useState(0);
  const terms = getPending().terms;
  // A rule whose value does not fit its setting is left out rather than guessed at.
  const rules = useMemo(
    () =>
      (terms?.rules ?? [])
        .map((r) => {
          const def = paramByKey[r.key];
          const raw = !def ? null : def.merge === "any" ? r.yes : def.merge === "union" || def.merge === "common" ? r.list : def.unit ? r.number : r.text;
          const value = ruleValue(r.key, raw);
          return value === null ? null : { key: r.key, value: value as Value, source: r.source, quote: r.quote, def };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [terms],
  );
  const others = terms?.terms ?? [];
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const keptRules = rules.filter((r) => !off.has(`r:${r.key}`));
  const keptTerms = others.filter((x) => !off.has(`t:${x.text}`));
  const toggle = (k: string, on: boolean) => setOff((s) => (on ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const save = async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await post(code, user.id, { action: "rules", values: keptRules.map((r) => ({ key: r.key, value: r.value, source: r.source })), terms: keptTerms.map((x) => ({ text: x.text.slice(0, 600), source: x.source.slice(0, 200) })), file: getPending().termsFile });
      setSaved(true);
      clearPending("terms");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1 className="font-display text-3xl leading-tight tracking-tight">{t("ag.rules.title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("ag.rules.help")}</p>
      {!terms && !saved && user && (
        <div className="mt-4">
          <FromDocuments user={user.id} project={code} onRead={() => setTick((n) => n + 1)} />
        </div>
      )}
      {terms && !rules.length && !others.length && <p className="mt-4 text-sm text-muted">{t("ag.rules.none")}</p>}
      {rules.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rules.map((r) => (
            <li key={r.key} className="rounded-2xl border border-line bg-surface p-3">
              <label className="flex items-start gap-3 text-sm">
                <Check on={!off.has(`r:${r.key}`)} set={(v) => toggle(`r:${r.key}`, v)} label={r.def.label} />
                <span>
                  <span className="block">
                    {r.def.label}: <span className="font-semibold">{show(r.def, r.value)}</span>
                  </span>
                  {r.quote && <span className="mt-1 block text-xs italic text-muted">&ldquo;{r.quote}&rdquo;</span>}
                  <span className="block text-xs text-muted">{t("ag.source", { source: r.source })}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <div className="mt-6">
          <p className="font-semibold">{t("ag.rules.terms")}</p>
          <p className="text-xs text-muted">{t("ag.rules.termsHelp")}</p>
          <ul className="mt-2 space-y-2">
            {others.map((x) => (
              <li key={x.text}>
                <label className="flex items-start gap-3 text-sm">
                  <Check on={!off.has(`t:${x.text}`)} set={(v) => toggle(`t:${x.text}`, v)} label={x.text} />
                  <span>
                    {x.text} <span className="text-xs text-muted">({x.source})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-clay">{error}</p>}
      {saved && <p className="mt-3 text-sm text-leaf">{t("ag.rules.saved")}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {(keptRules.length > 0 || keptTerms.length > 0) && !saved && (
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>
            {t("ag.rules.save", { n: keptRules.length, m: keptTerms.length })}
          </button>
        )}
        <button type="button" className={quietBtn} onClick={onDone}>
          {saved ? t("plan.continue") : t("ag.skip")}
        </button>
      </div>
    </section>
  );
}
