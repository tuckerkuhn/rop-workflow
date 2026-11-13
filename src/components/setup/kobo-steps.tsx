"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LookedAt, Why } from "@/components/app/ai-why";
import { useT } from "@/components/app/i18n";
import { useKobo, useProgress } from "@/components/app/use-project-data";
import { useSession } from "@/components/app/session";
import { mappingRisks, type Suggestion } from "@/lib/kobo-suggest";
import { Question, field } from "@/components/setup/question";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { FORM_PURPOSES, MAPPING_METHODS, guessPurpose, type FormPurpose, type KoboFormInfo, type KoboMapping, type KoboQuestion, type MappingMethod, type AutoSyncSecret, type SyncCounts } from "@/lib/kobo-setup";
import type { MessageKey } from "@/lib/i18n";

/**
 * Setup steps for KoboToolbox: connect the account, choose the project's forms, and say which
 * question counts toward each indicator. Field data collection stays in KoboToolbox.
 */

const SERVERS = ["https://kf.kobotoolbox.org", "https://eu.kobotoolbox.org"];

function Actions({ busy, label, onClick, disabled, extra }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean; extra?: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {extra}
      <button type="button" onClick={onClick} disabled={busy || disabled} className={`${primaryBtn} flex-1`}>
        {busy ? t("settings.saving") : label}
      </button>
    </div>
  );
}

function Alert({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
      {text}
    </p>
  ) : null;
}

export function KoboConnect({ code, onDone, onSkip }: { code: string; onDone: () => void; onSkip: () => void }) {
  const { t } = useT();
  const kobo = useKobo(code);
  const saved = kobo.state?.connection;
  const [server, setServer] = useState(SERVERS[0]);
  const [token, setToken] = useState("");
  const [countOnly, setCountOnly] = useState<"all" | "approved">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!saved) return;
    setServer(saved.serverUrl);
    setCountOnly(saved.countOnly);
  }, [saved]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await kobo.connect({ serverUrl: server, token: token.trim() || undefined, countOnly });
      setToken("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Question title={t("kobo.q.connect")} help={t("kobo.h.connect")}>
      <label className="block text-sm font-medium">
        {t("kobo.server")}
        <input value={server} onChange={(e) => setServer(e.target.value)} list="kobo-servers" inputMode="url" autoComplete="off" className={field} />
        <datalist id="kobo-servers">
          {SERVERS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className="mt-4 block text-sm font-medium">
        {t("kobo.token")}
        {/* A password field keeps the token off screen and out of autofill history. */}
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={saved ? t("kobo.tokenSaved", { hint: saved.tokenHint }) : ""} className={field} />
        <span className="mt-1 block text-xs font-normal text-muted">{t("kobo.tokenHelp")}</span>
      </label>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium">{t("kobo.countOnly")}</legend>
        {(["all", "approved"] as const).map((k) => (
          <label key={k} className="mt-2 flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
            <input type="radio" name="count-only" checked={countOnly === k} onChange={() => setCountOnly(k)} className="mt-0.5 h-4 w-4 accent-[var(--forest)]" />
            <span>{t(k === "all" ? "kobo.countAll" : "kobo.countApproved")}</span>
          </label>
        ))}
      </fieldset>
      <Alert text={error || kobo.error} />
      <Actions
        busy={busy}
        label={t(saved ? "kobo.saveConnection" : "kobo.connect")}
        disabled={!server.trim() || (!saved && !token.trim())}
        onClick={() => void submit()}
        extra={
          <button type="button" onClick={saved ? onDone : onSkip} className={quietBtn}>
            {t(saved ? "setup.next" : "kobo.skip")}
          </button>
        }
      />
      {saved && (
        <p className="mt-4 text-sm">
          <button
            type="button"
            onClick={() => void kobo.disconnect().catch((e: Error) => setError(e.message))}
            className="font-semibold text-clay hover:underline"
          >
            {t("kobo.disconnect")}
          </button>
        </p>
      )}
    </Question>
  );
}

export function KoboForms({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useT();
  const kobo = useKobo(code);
  const [forms, setForms] = useState<KoboFormInfo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState<Record<string, FormPurpose>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { liveForms } = kobo;
  const chosen = kobo.state?.forms;

  useEffect(() => {
    if (forms || !chosen) return;
    setPicked(new Set(chosen.map((f) => f.uid)));
    liveForms()
      .then((live) => {
        // Saved choice first; otherwise a guess from the form's name.
        setPurpose(Object.fromEntries(live.map((f) => [f.uid, chosen.find((c) => c.uid === f.uid)?.purpose ?? guessPurpose(f.name)])));
        setForms(live);
      })
      .catch((e: Error) => setError(e.message));
  }, [forms, chosen, liveForms]);

  const toggle = (uid: string) => setPicked((p) => (p.has(uid) ? new Set([...p].filter((x) => x !== uid)) : new Set([...p, uid])));
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await kobo.saveForms((forms ?? []).filter((f) => picked.has(f.uid)).map((f) => ({ uid: f.uid, name: f.name, purpose: purpose[f.uid] ?? guessPurpose(f.name) })));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Question title={t("kobo.q.forms")} help={t("kobo.h.forms")}>
      {!forms && !error && <p className="text-sm text-muted">{t("kobo.loadingForms")}</p>}
      {forms?.length === 0 && <p className="text-sm text-muted">{t("kobo.noForms")}</p>}
      <ul className="space-y-2">
        {forms?.map((f) => (
          <li key={f.uid}>
            <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${picked.has(f.uid) ? "border-forest bg-mist" : "border-line bg-surface"}`}>
              <input type="checkbox" checked={picked.has(f.uid)} onChange={() => toggle(f.uid)} className="mt-0.5 h-4 w-4 accent-[var(--forest)]" />
              <span className="min-w-0">
                <span className="font-medium">{f.name}</span>
                <span className="block text-xs text-muted">
                  {t(f.deployed ? "kobo.deployed" : "kobo.notDeployed")} · {t("kobo.submissions", { n: f.submissions ?? 0 })}
                </span>
              </span>
            </label>
            {picked.has(f.uid) && (
              <fieldset className="mt-2 ms-7 space-y-1 text-sm">
                <legend className="text-xs font-medium text-muted">{t("kobo.purpose")}</legend>
                {FORM_PURPOSES.map((p) => (
                  <label key={p} className="flex items-start gap-2">
                    <input type="radio" name={`purpose-${f.uid}`} checked={(purpose[f.uid] ?? guessPurpose(f.name)) === p} onChange={() => setPurpose((x) => ({ ...x, [f.uid]: p }))} className="mt-1 accent-[var(--forest)]" />
                    <span>{t(p === "readiness" ? "kobo.purpose.readiness" : p === "distribution" ? "kobo.purpose.distribution" : "kobo.purpose.data")}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </li>
        ))}
      </ul>
      <Alert text={error} />
      {forms && <Actions busy={busy} label={t("setup.next")} disabled={!picked.size} onClick={() => void submit()} />}
    </Question>
  );
}

const METHOD_LABEL: Record<MappingMethod, MessageKey> = {
  count_answered: "kobo.method.count_answered",
  count_answer: "kobo.method.count_answer",
  count_unique: "kobo.method.count_unique",
  sum: "kobo.method.sum",
};

type Draft = Record<string, KoboMapping | undefined>;

export function KoboMap({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useT();
  const { user } = useSession();
  const kobo = useKobo(code);
  const progress = useProgress(code);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [questions, setQuestions] = useState<Record<string, KoboQuestion[] | "loading">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const forms = kobo.state?.forms ?? [];
  const indicators = progress.data?.indicators ?? [];
  const { questions: loadQuestions } = kobo;

  useEffect(() => {
    if (draft || !kobo.state) return;
    setDraft(Object.fromEntries(kobo.state.mappings.map((m) => [m.indicatorCode, m])));
  }, [draft, kobo.state]);

  // Load each form's questions once, when a mapping needs them.
  useEffect(() => {
    for (const uid of new Set(Object.values(draft ?? {}).flatMap((m) => (m ? [m.assetUid] : [])))) {
      if (questions[uid]) continue;
      setQuestions((q) => ({ ...q, [uid]: "loading" }));
      loadQuestions(uid)
        .then((list) => setQuestions((q) => ({ ...q, [uid]: list })))
        .catch((e: Error) => setError(e.message));
    }
  }, [draft, questions, loadQuestions]);

  // A mapping keeps where it came from: accepting a suggestion marks it suggested; changing one afterwards marks it changed.
  const set = (code: string, m: KoboMapping | undefined) =>
    setDraft((d) => {
      const prev = d?.[code]?.origin;
      const origin = !m ? undefined : m.origin === "suggested" && !prev?.startsWith("suggested") ? "suggested" : prev?.startsWith("suggested") && m.origin !== "suggested" ? "suggested-edited" : (m.origin ?? prev ?? "manual");
      return { ...d, [code]: m && { ...m, origin } };
    });
  const accept = (s: Suggestion) => {
    if (!s.mapping) return;
    setDraft((d) => ({ ...d, [s.indicatorCode]: { ...s.mapping!, indicatorCode: s.indicatorCode, origin: "suggested" } }));
  };
  // Suggestions the person turned down: left unmapped for them to do by hand, and put on the record.
  const [declined, setDeclined] = useState<string[]>([]);
  const decline = (s: Suggestion) => {
    if (!s.mapping || !user) return;
    setDeclined((d) => [...d, s.indicatorCode]);
    void fetch(`/api/projects/${code}/kobo/suggest`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-demo-user": user.id },
      body: JSON.stringify({ indicatorCode: s.indicatorCode, question: s.mapping.question, method: s.mapping.method, confidence: s.confidence, reason: s.reason }),
    }).catch(() => undefined);
  };
  const [ai, setAi] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    if (!user) return;
    fetch(`/api/projects/${code}/kobo/suggest`, { headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAi(!!d?.ai))
      .catch(() => undefined);
  }, [code, user]);
  const suggest = async () => {
    if (!user) return;
    setSuggesting(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${code}/kobo/suggest`, { method: "POST", headers: { "x-demo-user": user.id } });
      const d = (await r.json().catch(() => ({}))) as { suggestions?: Suggestion[]; questions?: Record<string, KoboQuestion[]>; error?: string };
      if (!r.ok || !d.suggestions) throw new Error(d.error ?? "Could not suggest mappings.");
      setSuggestions(d.suggestions);
      setDeclined([]);
      setQuestions((q) => ({ ...(d.questions ?? {}), ...Object.fromEntries(Object.entries(q).filter(([, v]) => Array.isArray(v))) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };
  const loadedQuestions = Object.fromEntries(Object.entries(questions).filter((e): e is [string, KoboQuestion[]] => Array.isArray(e[1])));
  const risks = mappingRisks(Object.values(draft ?? {}).filter((m): m is KoboMapping => !!m && !!m.question), loadedQuestions, indicators);
  const isAccepted = (s: Suggestion) => {
    const m = draft?.[s.indicatorCode];
    return !!s.mapping && m?.origin === "suggested" && m.question === s.mapping.question && m.assetUid === s.mapping.assetUid;
  };
  const high = (suggestions ?? []).filter((s) => s.mapping && s.confidence === "high" && !isAccepted(s));
  const ready = Object.values(draft ?? {}).every((m) => !m || (m.question && (m.method !== "count_answer" || m.value)));
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await kobo.saveMappings(Object.values(draft ?? {}).filter((m): m is KoboMapping => !!m && !!m.question));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!forms.length)
    return (
      <Question title={t("kobo.q.map")}>
        <p className="text-sm text-muted">{t("kobo.noFormsChosen")}</p>
        <Actions busy={false} label={t("setup.next")} onClick={onDone} />
      </Question>
    );

  return (
    <Question title={t("kobo.q.map")} help={t("kobo.h.map")}>
      {ai && (
        <section className="mb-4 rounded-2xl border border-forest/30 bg-mist p-4 text-sm">
          <p className="text-muted">{t("ks.help")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={quietBtn} disabled={suggesting} onClick={() => void suggest()}>
              {suggesting ? t("ks.suggesting") : t("ks.suggest")}
            </button>
            {high.length > 0 && (
              <button type="button" className={primaryBtn} onClick={() => high.forEach(accept)}>
                {t("ks.acceptHigh", { n: high.length })}
              </button>
            )}
          </div>
          {suggestions && <LookedAt what="koboSuggest" className="mt-3" />}
          {suggestions && (
            <ul className="mt-3 space-y-2">
              {suggestions.map((s) => {
                const ind = indicators.find((i) => i.code === s.indicatorCode);
                const qs = s.mapping ? loadedQuestions[s.mapping.assetUid] : undefined;
                const q = qs?.find((x) => x.path === s.mapping?.question);
                const form = forms.find((f) => f.uid === s.mapping?.assetUid);
                return (
                  <li key={s.indicatorCode} className="rounded-xl border border-line bg-surface p-3">
                    <p className="font-medium">{ind?.name ?? s.indicatorCode}</p>
                    {s.mapping ? (
                      <>
                        <p className="mt-1">
                          {form?.name} › {q?.label ?? s.mapping.question} · {t(METHOD_LABEL[s.mapping.method])}
                          {s.mapping.value ? ` (${q?.choices.find((c) => c.name === s.mapping!.value)?.label ?? s.mapping.value})` : ""}
                        </p>
                        <p className="text-xs text-muted">
                          <Why>{s.reason}</Why>
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.confidence === "high" ? "bg-mist text-leaf" : s.confidence === "medium" ? "bg-ochre-soft text-ochre" : "bg-clay-soft text-clay"}`}>{t(`ks.conf.${s.confidence}`)}</span>
                          {isAccepted(s) ? (
                            <span className="text-xs font-semibold text-leaf">✓ {t("ks.accepted")}</span>
                          ) : declined.includes(s.indicatorCode) ? (
                            <span className="text-xs font-semibold text-muted">{t("ks.declined")}</span>
                          ) : (
                            <>
                              <button type="button" className={`${quietBtn} min-h-11`} onClick={() => accept(s)}>
                                {t("ks.accept")}
                              </button>
                              <button type="button" className={`${quietBtn} min-h-11`} onClick={() => decline(s)}>
                                {t("ks.decline")}
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-muted">{t("ks.none", { reason: s.reason })}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {risks.length > 0 && (
        <div role="status" className="mb-4 rounded-2xl border border-ochre bg-ochre-soft p-4 text-sm">
          <p className="font-semibold">⚠ {t("ks.risks")}</p>
          <ul className="mt-1 list-disc ps-5">
            {risks.map((r) => (
              <li key={`${r.indicatorCode}${r.kind}`}>
                <span className="font-medium">{indicators.find((i) => i.code === r.indicatorCode)?.name ?? r.indicatorCode}:</span> {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-3">
        {indicators.map((i) => {
          const m = draft?.[i.code];
          const qs = m ? questions[m.assetUid] : undefined;
          const q = Array.isArray(qs) ? qs.find((x) => x.path === m?.question) : undefined;
          // Built-in demo indicators already count from the readiness, training and distribution forms.
          const builtIn = i.dataSource === "records" && !m;
          return (
            <li key={i.code} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-medium">{i.name}</p>
              <p className="text-xs text-muted">
                {i.code} · {i.target} {i.unit}
                {builtIn && ` · ${t("kobo.builtIn")}`}
                {m?.origin && m.origin !== "manual" && ` · ${t(`ks.origin.${m.origin}`)}`}
              </p>
              <label className="mt-3 block text-xs text-muted">
                {t("kobo.form")}
                <select
                  value={m?.assetUid ?? ""}
                  onChange={(e) => set(i.code, e.target.value ? { indicatorCode: i.code, assetUid: e.target.value, question: "", method: "count_answered", value: null } : undefined)}
                  className={field}
                >
                  <option value="">{t("kobo.notMapped")}</option>
                  {forms.map((f) => (
                    <option key={f.uid} value={f.uid}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {m && (
                <>
                  <label className="mt-2 block text-xs text-muted">
                    {t("kobo.question")}
                    <select value={m.question} onChange={(e) => set(i.code, { ...m, question: e.target.value, value: null })} disabled={!Array.isArray(qs)} className={field}>
                      <option value="">{qs === "loading" ? t("kobo.loadingQuestions") : t("kobo.pickQuestion")}</option>
                      {Array.isArray(qs) &&
                        qs.map((x) => (
                          <option key={x.path} value={x.path}>
                            {x.label} ({x.path})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="mt-2 block text-xs text-muted">
                    {t("kobo.how")}
                    <select value={m.method} onChange={(e) => set(i.code, { ...m, method: e.target.value as MappingMethod, value: null })} className={field}>
                      {MAPPING_METHODS.map((k) => (
                        <option key={k} value={k}>
                          {t(METHOD_LABEL[k])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {m.method === "count_answer" && (
                    <label className="mt-2 block text-xs text-muted">
                      {t("kobo.answer")}
                      {q?.choices.length ? (
                        <select value={m.value ?? ""} onChange={(e) => set(i.code, { ...m, value: e.target.value || null })} className={field}>
                          <option value="" />
                          {q.choices.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input value={m.value ?? ""} onChange={(e) => set(i.code, { ...m, value: e.target.value || null })} className={field} />
                      )}
                    </label>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {indicators.length === 0 && <p className="text-sm text-muted">{t("progress.empty")}</p>}
      <Alert text={error} />
      <Actions busy={busy} label={t("kobo.saveMappings")} disabled={!ready} onClick={() => void submit()} />
    </Question>
  );
}

export function KoboDone({ code, name }: { code: string; name: string }) {
  const { t } = useT();
  const kobo = useKobo(code);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncCounts | null>(null);
  const [error, setError] = useState("");
  const connected = !!kobo.state?.connection && !!kobo.state.forms.length;
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await kobo.sync());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Question title={t("setup.q.done", { name })} help={t(connected ? "setup.h.doneConnected" : "setup.h.done")}>
      {connected && (
        <button type="button" onClick={() => void run()} disabled={busy} className={`${quietBtn} w-full`}>
          {busy ? t("kobo.syncing") : t("kobo.syncNow")}
        </button>
      )}
      {result && <p className="mt-3 text-sm text-forest">{t("kobo.synced", { added: result.added, fetched: result.fetched, forms: result.forms })}
          {(result.updated > 0 || result.removed > 0) && ` ${t("kobo.syncedChanges", { updated: result.updated, removed: result.removed })}`}
          {result.results && (result.results.added > 0 || result.results.updated > 0 || result.results.flagged > 0) && (
            <span className="mt-1 block">
              {`${result.results.added} new ${result.results.added === 1 ? "result" : "results"} for MEL to check (${result.results.photos} photos as proof)`}
              {result.results.updated ? `, ${result.results.updated} updated` : ""}
              {result.results.flagged ? `; ${result.results.flagged} already accepted changed in KoboToolbox: see the audit trail` : ""}.
            </span>
          )}</p>}
      <Alert text={error} />
      {connected && <KoboAutoSync code={code} />}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/home" className={quietBtn}>
          {t("nav.home")}
        </Link>
        <Link href="/progress" className={`${primaryBtn} flex-1 text-center`}>
          {t("progress.title")}
        </Link>
      </div>
    </Question>
  );
}

/** Automatic sync: this link's own KoboToolbox REST Service password, shown once when made. */
function KoboAutoSync({ code }: { code: string }) {
  const { t, date } = useT();
  const kobo = useKobo(code);
  const since = kobo.state?.connection?.autoSyncSince ?? null;
  const [secret, setSecret] = useState<AutoSyncSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const turnOn = () => act(async () => setSecret(await kobo.enableAutoSync()));
  const turnOff = () => act(async () => {
    await kobo.disableAutoSync();
    setSecret(null);
  });
  const rows = secret
    ? [
        { label: t("kobo.auto.url"), value: `${window.location.origin}${secret.path}` },
        { label: t("kobo.auto.username"), value: secret.username },
        { label: t("kobo.auto.password"), value: secret.password },
      ]
    : [];
  return (
    <section className="mt-8 rounded-2xl border border-line p-4">
      <h3 className="font-semibold">{t("kobo.auto.title")}</h3>
      <p className="mt-1 text-sm text-muted">{since ? t("kobo.auto.on", { date: date(since) }) : t("kobo.auto.off")}</p>
      {secret && (
        <div className="mt-4 text-sm">
          <p>{t("kobo.auto.steps")}</p>
          <dl className="mt-3 space-y-2">
            {rows.map((r) => (
              <div key={r.label}>
                <dt className="text-muted">{r.label}</dt>
                <dd className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-black/5 px-2 py-1">{r.value}</code>
                  <button type="button" className={quietBtn} onClick={() => void navigator.clipboard?.writeText(r.value)}>
                    {t("kobo.auto.copy")}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3">{t("kobo.auto.format")}</p>
          <p className="mt-2 font-medium text-clay">{t("kobo.auto.once")}</p>
        </div>
      )}
      <Alert text={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void turnOn()} className={since ? quietBtn : primaryBtn}>
          {since ? t("kobo.auto.newPassword") : t("kobo.auto.turnOn")}
        </button>
        {since && (
          <button type="button" disabled={busy} onClick={() => void turnOff()} className={quietBtn}>
            {t("kobo.auto.turnOff")}
          </button>
        )}
      </div>
    </section>
  );
}
