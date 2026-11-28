"use client";

import { FilesPanel } from "@/components/settings/files-panel";
import { FxSection } from "@/components/settings/fx-section";
import { ReasonNeeded, reasonMissing } from "@/components/settings/reason-needed";
import { STORES } from "@/lib/file-store";
import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { GapPanel } from "@/components/settings/gap-panel";
import { Pill, TopBar, primaryBtn, quietBtn, Loading } from "@/components/workspace/ui";
import { Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import { layerable, show, type Area, type ParamDef, type Value } from "@/lib/policy";
import { kindOf } from "@/lib/presets";
import type { OrgSettingsView } from "@/app/api/org/settings/route";

/**
 * Organization settings: the rules the whole organization works by, grouped by department. The
 * written policy always applies. A requirement profile (UN, World Bank, Conservative, Small staff)
 * is compared with it, and where the profile requires more, the gap can be approved and layered
 * on. An administrator can also add a stricter standard of their own. Every change is kept.
 */

async function call<T>(user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch("/api/org/settings", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const field = "min-h-11 w-full border border-line bg-paper px-3 py-2 text-sm focus:border-forest focus:outline-none";
// Ruled rows: a rule and its value; a requirement profile, how it compares and its button; a change and when.
const RULE = "1fr auto";
const PROFILE = "1fr auto";
const CHANGE = "9rem 1fr";
const same = (a: Value, b: Value) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function OrgSettingsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<OrgSettingsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dept, setDept] = useState<Area | "all">("all");
  const [profile, setProfile] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Which set-up option is open (files, solo, sample); a link like /settings/org#files opens it.
  const [openSetup, setOpenSetup] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (["files", "solo", "sample"].includes(h)) setOpenSetup(h);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<OrgSettingsView>(user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  if (!user) return null;
  const def = (k: string) => v!.params.find((p) => p.key === k) as ParamDef;
  const now = (k: string) => (v?.current[k]?.value ?? null) as Value;
  const pending = Object.entries(draft).filter(([k, val]) => !same(val, now(k)));

  const post = async (body: object, msg: string) => {
    setError("");
    try {
      setV(await call<OrgSettingsView>(user.id, { method: "POST", body: JSON.stringify(body) }));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const setValue = (k: string, val: Value) =>
    setDraft((d) => {
      const next = { ...d };
      if (same(val, now(k))) delete next[k];
      else next[k] = val;
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      await post({ action: "set", changes: pending.map(([key, value]) => ({ key, value })), reason }, `Saved ${pending.length} ${pending.length === 1 ? "change" : "changes"}. Projects follow them from now on.`);
      setDraft({});
      setReason("");
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };

  const chosen = v?.profiles.find((p) => p.id === profile) ?? null;
  const gaps = chosen?.comparison.filter((c) => c.status === "gap") ?? [];
  const met = chosen?.comparison.filter((c) => c.status === "met") ?? [];
  const ours = chosen?.comparison.filter((c) => c.status === "ours") ?? [];
  const depts = v ? (dept === "all" ? v.departments : [dept]) : [];

  return (
    <div className="min-h-screen pb-40">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <PageHead kicker={v?.name ?? "Organization"} title="Organization settings">
          <p>The rules the whole organization works by, by department: our written policy always applies, stricter requirements can be layered on, and every change keeps who made it, when and why.</p>
          <p className="mt-2">
            <Link href="/settings" className="font-semibold text-forest hover:underline">
              Project settings
            </Link>{" "}
            ·{" "}
            <Link href="/settings/policy" className="font-semibold text-forest hover:underline">
              Rules a project follows, with its donor&apos;s gaps
            </Link>
          </p>
        </PageHead>
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v && !error && <Loading className="mt-6" />}
        {v && !v.admin && <p className="mt-4 bg-sunken px-4 py-3 text-sm text-muted">Only an administrator adds to these. You can see every rule and where it comes from.</p>}

        {v && (
          <>
            <SetupJump open={setOpenSetup} sample={!!v.sampleProject} />
            <SectionHead>Rules by department</SectionHead>
            <nav className="mt-3 flex flex-wrap gap-1" aria-label="Departments">
              {(["all", ...v.departments] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDept(d)}
                  aria-pressed={dept === d}
                  className={`min-h-11 px-3 font-mono text-xs ${dept === d ? "font-bold underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"}`}
                >
                  {d === "all" ? "All departments" : d}
                </button>
              ))}
            </nav>

            {depts.map((area) => (
              <section key={area}>
                <SectionHead className="mt-6">{area}</SectionHead>
                <LedgerTable cols={RULE} head={["Rule", { label: "Now", end: true }]} label={area}>
                  {v.params
                    .filter((p) => p.area === area)
                    .map((d) => (
                      <RuleRow
                        key={d.key}
                        d={d}
                        current={v.current[d.key] ? { value: v.current[d.key].value, source: v.current[d.key].source } : null}
                        policy={v.policy[d.key] ? { value: v.policy[d.key].value, source: v.policy[d.key].source } : null}
                        changed={!!v.changed[d.key]}
                        draft={d.key in draft ? draft[d.key] : undefined}
                        admin={v.admin}
                        onChange={(val) => setValue(d.key, val)}
                        onDrop={() =>
                          setDraft((dr) => {
                            const next = { ...dr };
                            delete next[d.key];
                            return next;
                          })
                        }
                        onReset={(why) => post({ action: "reset", keys: [d.key], reason: why }, `${d.label}: back to our written policy.`)}
                      />
                    ))}
                </LedgerTable>
              </section>
            ))}

            <section className="mt-10">
              <SectionHead className="">Requirement profiles</SectionHead>
              <p className="mt-1 max-w-3xl text-sm text-muted">Compare a donor or standard&rsquo;s requirements with our procedures; where it asks for more, an administrator can layer it on.</p>
              <LedgerTable cols={PROFILE} head={["Profile", "Compared with ours"]} label="Requirement profiles">
                {v.profiles.map((p) => {
                  const n = p.comparison.filter((c) => c.status === "gap").length;
                  return (
                    <LedgerRow key={p.id} cols={PROFILE} selected={profile === p.id} className="text-sm">
                      <span className="min-w-0">
                        <span className="block font-bold">{p.name}</span>
                        <span className="mt-0.5 block text-muted">{p.summary}</span>
                        <button type="button" onClick={() => setProfile(profile === p.id ? null : p.id)} className={`${quietBtn} mt-2`}>
                          {profile === p.id ? "Close" : "Compare with our procedures"}
                        </button>
                      </span>
                      <span>
                        {n > 0 ? (
                          <StatusBlock tone="ochre">
                            {n} {n === 1 ? "gap" : "gaps"}
                          </StatusBlock>
                        ) : (
                          <StatusBlock tone="forest">Met</StatusBlock>
                        )}
                      </span>
                    </LedgerRow>
                  );
                })}
              </LedgerTable>
            </section>

            {chosen && (
              <>
                {gaps.length > 0 ? (
                  <GapPanel
                    key={`${chosen.id}-${gaps.map((g) => g.key).join(",")}`}
                    title={`${chosen.name}: ${gaps.length} ${gaps.length === 1 ? "requirement goes" : "requirements go"} beyond our procedures`}
                    intro="Tick the ones to layer on top of our procedures for the whole organization. The rest stay as our procedures say."
                    items={gaps.map((g) => ({ key: g.key, label: def(g.key).label, ours: show(def(g.key), g.ours), required: show(def(g.key), g.required), result: show(def(g.key), g.result), source: g.source }))}
                    canApprove={v.admin}
                    cannot="An administrator approves these."
                    onApprove={(keys, why) => post({ action: "layer", profile: chosen.id, keys, reason: why }, `${keys.length} ${chosen.name} ${keys.length === 1 ? "requirement" : "requirements"} layered on.`)}
                  />
                ) : (
                  <p className="mt-6 bg-mist px-4 py-3 text-sm text-leaf">Our procedures already meet everything {chosen.name} requires.</p>
                )}
                {(met.length > 0 || ours.length > 0) && (
                  <Sheet className="mt-4 text-sm">
                    {met.length > 0 && (
                      <p>
                        <span className="font-semibold">Already met:</span> <span className="text-muted">{met.map((c) => def(c.key).label).join("; ")}.</span>
                      </p>
                    )}
                    {ours.length > 0 && (
                      <p className="mt-1">
                        <span className="font-semibold">Our procedures ask for more, and stay:</span>{" "}
                        <span className="text-muted">{ours.map((c) => `${def(c.key).label} (ours ${show(def(c.key), c.ours)}, profile ${show(def(c.key), c.required)})`).join("; ")}.</span>
                      </p>
                    )}
                  </Sheet>
                )}
              </>
            )}

            {/* Set-up options: chosen once, changed rarely. Each opens in place; the links at the top open them too. */}
            <section id="setup" className="mt-10 scroll-mt-24">
              <SectionHead className="">Set-up options</SectionHead>
              <p className="mt-1 max-w-3xl text-sm text-muted">Where files are kept, solo mode for sign-offs, and the sample project. Open one to see it or change it.</p>
              <div className="mt-3 border-t border-ink [&>details:last-child]:border-ink">
                <SetupItem id="files" title="Where files are kept" now={v.files.stores.map((x) => STORES.find((st) => st.id === x)?.name ?? x).join(", ") || "Not chosen yet"} open={openSetup === "files"} onToggle={(o) => setOpenSetup(o ? "files" : null)}>
                  <FilesPanel v={v} post={post} />
                </SetupItem>
                <SetupItem id="fx" title="Exchange rates" now="Afghani and quetzal, by month" open={openSetup === "fx"} onToggle={(o) => setOpenSetup(o ? "fx" : null)}>
                  <FxSection />
                </SetupItem>
                <SetupItem id="solo" title="Solo mode" now={v.solo?.on ? "On" : "Off"} open={openSetup === "solo"} onToggle={(o) => setOpenSetup(o ? "solo" : null)}>
                  <SoloPanel v={v} post={post} />
                </SetupItem>
                {v.sampleProject && (
                  <SetupItem id="sample" title="Sample project" now={v.sampleProject.hidden ? "Hidden" : "Shown"} open={openSetup === "sample"} onToggle={(o) => setOpenSetup(o ? "sample" : null)}>
                    <SamplePanel v={v} post={post} />
                  </SetupItem>
                )}
              </div>
            </section>

            {v.history.length > 0 && (
              <section className="mt-10">
                <SectionHead className="">Changes</SectionHead>
                <LedgerTable cols={CHANGE} head={["When", "What changed"]} label="Changes">
                  {v.history.slice(0, 50).map((h, i) => (
                    <LedgerRow key={i} cols={CHANGE} className="text-sm">
                      <Fig className="text-start text-muted">{h.at}</Fig>
                      <span className="min-w-0">
                        {def(h.key)?.label ?? h.key} {h.reset ? "back to the written policy" : `set to ${show(def(h.key), h.value)}`}
                        {h.preset ? `, layered on from the ${v.profiles.find((p) => p.id === h.preset)?.name ?? h.preset} profile` : ""} by {h.name}. <span className="text-muted">{h.reason}</span>
                      </span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              </section>
            )}
          </>
        )}
      </main>

      {v && pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="text-sm font-semibold">
              {pending.length} {pending.length === 1 ? "change" : "changes"} to save
            </p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (kept with the change)" aria-label="Reason for the change" className={`${field} min-w-0 flex-1`} />
            <button type="button" className={quietBtn} onClick={() => setDraft({})}>
              Discard
            </button>
            <button type="button" disabled={busy || reasonMissing(reason)} onClick={() => void save()} className={primaryBtn}>
              {busy ? "Saving…" : "Save"}
            </button>
            <ReasonNeeded reason={reason} className="w-full text-end" />
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  d,
  current,
  policy,
  changed,
  draft,
  admin,
  onChange,
  onDrop,
  onReset,
}: {
  d: ParamDef;
  current: { value: Value; source: string } | null;
  policy: { value: Value; source: string } | null;
  changed: boolean;
  draft: Value | undefined;
  admin: boolean;
  onChange: (v: Value) => void;
  onDrop: () => void;
  onReset: (reason: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [why, setWhy] = useState("");
  const shown = draft !== undefined ? draft : (current?.value ?? null);
  const pendingChange = draft !== undefined;
  return (
    <LedgerRow cols={RULE} className={pendingChange ? "bg-ochre-soft/40" : ""}>
        <div className="min-w-0">
          <p className="font-semibold">{d.label}</p>
          {d.help && <p className="text-xs text-muted">{d.help}</p>}
        </div>
        <div className="text-end">
          <Fig strong className="block">{show(d, shown)}</Fig>
          {pendingChange && <p className="text-xs text-warn">Now {show(d, current?.value ?? null)} · not saved</p>}
          {!pendingChange && changed && <Pill tone="sky">Added to our policy</Pill>}
        </div>
      <p className="col-span-full text-xs text-muted">
        {current?.source ?? "Not set"}
        {!pendingChange && changed && policy ? ` · Written policy: ${show(d, policy.value)}` : ""}
      </p>
      {admin && (
        <div className="col-span-full flex flex-wrap items-center gap-3">
          {editing || pendingChange ? (
            <>
              <Editor d={d} value={shown} onChange={onChange} />
              <button type="button" onClick={() => (onDrop(), setEditing(false))} className="min-h-11 text-sm text-muted hover:text-clay">
                Keep as it is
              </button>
              {layerable(d) && <span className="w-full text-xs text-muted">Only stricter than our written policy ({show(d, policy?.value ?? null)}): it always applies.</span>}
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="min-h-11 text-sm font-medium text-forest hover:underline">
              {layerable(d) ? "Add a stricter requirement" : "Update"}
            </button>
          )}
          {changed && !pendingChange && !resetting && (
            <button type="button" onClick={() => setResetting(true)} className="min-h-11 text-sm text-muted hover:text-clay">
              Back to our written policy
            </button>
          )}
          {resetting && (
            <span className="flex w-full flex-wrap items-center gap-2">
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why" aria-label="Reason" className={`${field} min-w-0 flex-1`} />
              <button
                type="button"
                disabled={reasonMissing(why)}
                className={quietBtn}
                onClick={() =>
                  void onReset(why.trim())
                    .then(() => setResetting(false))
                    .catch(() => {})
                }
              >
                Remove the addition
              </button>
              <button type="button" onClick={() => setResetting(false)} className="min-h-11 text-sm text-muted">
                Cancel
              </button>
              <ReasonNeeded reason={why} to="remove it" className="w-full" />
            </span>
          )}
        </div>
      )}
    </LedgerRow>
  );
}

function Editor({ d, value, onChange }: { d: ParamDef; value: Value; onChange: (v: Value) => void }) {
  const kind = kindOf(d);
  if (kind === "boolean")
    return (
      <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")} className={`${field} w-40`} aria-label={d.label}>
        <option value="yes">Yes</option>
        <option value="no">No</option>
        <option value="">Not set</option>
      </select>
    );
  if (kind === "number")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          inputMode="decimal"
          defaultValue={value === null ? "" : String(value)}
          onChange={(e) => {
            const t = e.target.value.trim();
            const n = Number(t);
            if (t === "") onChange(null);
            else if (Number.isFinite(n) && n >= 0) onChange(n);
          }}
          className={`${field} w-40 tabular-nums`}
          aria-label={d.label}
        />
        <span className="text-muted">{d.unit === "count" ? "" : d.unit}</span>
      </label>
    );
  if (kind === "list")
    return (
      <textarea
        rows={3}
        defaultValue={Array.isArray(value) ? value.join("\n") : ""}
        onChange={(e) => onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))}
        placeholder="One per line"
        className={`${field} w-full sm:w-[28rem]`}
        aria-label={d.label}
      />
    );
  return <input defaultValue={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)} className={`${field} w-full sm:w-[28rem]`} aria-label={d.label} />;
}

/** Solo mode for sign-offs (server/solo.ts): off by default; an administrator turns it on or off with a reason, and every change is kept. */
function SoloPanel({ v, post }: { v: OrgSettingsView; post: (body: object, msg: string) => Promise<void> }) {
  const { t, date } = useT();
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const on = !!v.solo?.on;
  const day = (d: string) => date(d, { day: "numeric", month: "short", year: "numeric" });
  const turn = async () => {
    setBusy(true);
    try {
      await post({ action: "solo", on: !on, reason: why }, on ? t("so.off") : t("so.on"));
      setWhy("");
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-ledger text-xl font-bold">{t("so.title")}</h2>
        <StatusBlock tone={on ? "ochre" : "muted"}>{on ? t("so.on") : t("so.off")}</StatusBlock>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">{t("so.help")}</p>
      <p className="mt-1 max-w-3xl text-sm font-semibold">{t("so.never")}</p>
      {v.solo && <p className="mt-2 text-xs text-muted">{t("so.since", { date: day(v.solo.at), who: v.solo.name, reason: v.solo.reason })}</p>}
      {v.admin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("so.reason")} aria-label={t("so.reason")} className={`${field} min-w-0 flex-1`} />
          <button type="button" disabled={busy || reasonMissing(why)} onClick={() => void turn()} className={`${on ? quietBtn : primaryBtn} min-h-12`}>
            {on ? t("so.turnOff") : t("so.turnOn")}
          </button>
          <ReasonNeeded reason={why} to={on ? "turn it off" : "turn it on"} className="w-full" />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("so.adminOnly")}</p>
      )}
      {v.soloHistory.length > 1 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">{t("so.history")}</summary>
          <ul className="mt-1 space-y-1">
            {v.soloHistory.slice(1, 30).map((h, i) => (
              <li key={i}>{t("so.changed", { date: day(h.at), state: h.on ? t("so.stateOn") : t("so.stateOff"), who: h.name, reason: h.reason })}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The sample project (C5): shown to everyone unless an administrator hides it. Its data is fictional, so one tap does it; who and when are kept. */
function SamplePanel({ v, post }: { v: OrgSettingsView; post: (body: object, msg: string) => Promise<void> }) {
  const { t, date } = useT();
  const [busy, setBusy] = useState(false);
  // Changes made before the reason became optional carry one; newer ones read without the trailing colon.
  const plain = (s: string) => s.trimEnd().replace(/:$/, "");
  const hidden = !!v.sampleProject?.hidden;
  const day = (d: string) => date(d, { day: "numeric", month: "short", year: "numeric" });
  const turn = async () => {
    setBusy(true);
    try {
      await post({ action: "sample", hidden: !hidden }, hidden ? t("sample.doneShown") : t("sample.doneHidden"));
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-ledger text-xl font-bold">{t("sample.title")}</h2>
        <StatusBlock tone={hidden ? "muted" : "forest"}>{hidden ? t("sample.hidden") : t("sample.shown")}</StatusBlock>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">{t("sample.help")}</p>
      {v.sampleChange && <p className="mt-2 text-xs text-muted">{plain(t("sample.since", { date: day(v.sampleChange.at), who: v.sampleChange.name, reason: v.sampleChange.reason }))}</p>}
      {v.admin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void turn()} className={`${hidden ? primaryBtn : quietBtn} min-h-12`}>
            {hidden ? t("sample.show") : t("sample.hide")}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("sample.adminOnly")}</p>
      )}
      {v.sampleHistory.length > 1 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">{t("sample.history")}</summary>
          <ul className="mt-1 space-y-1">
            {v.sampleHistory.slice(1, 30).map((h, i) => (
              <li key={i}>{plain(t("sample.changed", { date: day(h.at), state: h.hidden ? t("sample.stateHidden") : t("sample.stateShown"), who: h.name, reason: h.reason }))}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The set-up options in one line near the top: each link opens its option further down. */
function SetupJump({ open, sample }: { open: (id: string) => void; sample: boolean }) {
  const go = (id: string) => {
    open(id);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  return (
    <p className="mt-3 text-sm text-muted">
      Set-up options:{" "}
      {[
        ["files", "Where files are kept"],
        ["solo", "Solo mode"],
        ...(sample ? [["sample", "Sample project"]] : []),
      ].map(([id, label], i) => (
        <span key={id}>
          {i > 0 && " · "}
          <a href={`#${id}`} onClick={(e) => (e.preventDefault(), go(id))} className="font-semibold text-forest hover:underline">
            {label}
          </a>
        </span>
      ))}
    </p>
  );
}

/** One set-up option, folded: its name and what it is set to now; opened, the full panel. */
function SetupItem({ id, title, now, open, onToggle, children }: { id: string; title: string; now: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details id={id} open={open} onToggle={(e) => (e.currentTarget.open !== open ? onToggle(e.currentTarget.open) : undefined)} className="scroll-mt-24 border-b border-line font-ledger">
      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 px-3 py-2 hover:bg-ochre-soft">
        <span className="font-bold">{title}</span>
        <span className="font-mono text-xs text-muted">{now}</span>
      </summary>
      <div className="px-3 pb-4 [&>section]:mt-0 [&>section]:border-0 [&>section]:p-0">{children}</div>
    </details>
  );
}
