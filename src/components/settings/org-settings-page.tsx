"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { GapPanel } from "@/components/settings/gap-panel";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
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
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";
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
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{v?.name ?? "Organization"}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Organization settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The rules the whole organization works by, by department. Our written policy and procedures always apply. Where a requirement profile or a donor asks for more, it shows as a gap; once approved, it is layered on top. Every change says who approved it, when and why.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/settings" className="font-semibold text-forest hover:underline">
            Project settings
          </Link>{" "}
          ·{" "}
          <Link href="/settings/policy" className="font-semibold text-forest hover:underline">
            Rules a project follows, with its donor&apos;s gaps
          </Link>
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && !v.admin && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">Only an administrator adds to these. You can see every rule and where it comes from.</p>}

        {v && (
          <>
            <section className="mt-6">
              <SectionLabel>Requirement profiles</SectionLabel>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {v.profiles.map((p) => {
                  const n = p.comparison.filter((c) => c.status === "gap").length;
                  return (
                    <div key={p.id} className={`flex flex-col rounded-2xl border p-4 ${profile === p.id ? "border-forest bg-mist" : "border-line bg-surface"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{p.name}</p>
                        {n > 0 ? <Pill tone="ochre">{n} {n === 1 ? "gap" : "gaps"}</Pill> : <Pill tone="forest">Met</Pill>}
                      </div>
                      <p className="mt-1 flex-1 text-sm text-muted">{p.summary}</p>
                      <button type="button" onClick={() => setProfile(profile === p.id ? null : p.id)} className={`${quietBtn} mt-3 self-start`}>
                        {profile === p.id ? "Close" : "Compare with our procedures"}
                      </button>
                    </div>
                  );
                })}
              </div>
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
                  <p className="mt-6 rounded-2xl border border-forest/40 bg-mist px-4 py-3 text-sm text-leaf">Our procedures already meet everything {chosen.name} requires.</p>
                )}
                {(met.length > 0 || ours.length > 0) && (
                  <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
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
                  </div>
                )}
              </>
            )}

            <nav className="mt-8 flex flex-wrap gap-2" aria-label="Departments">
              {(["all", ...v.departments] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDept(d)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${dept === d ? "bg-forest text-forest-ink" : "border border-line bg-surface hover:border-forest"}`}
                >
                  {d === "all" ? "All departments" : d}
                </button>
              ))}
            </nav>

            {depts.map((area) => (
              <section key={area} className="mt-6">
                <SectionLabel>{area}</SectionLabel>
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
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
                </ul>
              </section>
            ))}

            {v.history.length > 0 && (
              <section className="mt-10">
                <SectionLabel>Changes</SectionLabel>
                <ul className="mt-2 space-y-1 text-sm">
                  {v.history.slice(0, 50).map((h, i) => (
                    <li key={i}>
                      {h.at}: {def(h.key)?.label ?? h.key} {h.reset ? "back to the written policy" : `set to ${show(def(h.key), h.value)}`}
                      {h.preset ? `, layered on from the ${v.profiles.find((p) => p.id === h.preset)?.name ?? h.preset} profile` : ""} by {h.name}. <span className="text-muted">{h.reason}</span>
                    </li>
                  ))}
                </ul>
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
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void save()} className={primaryBtn}>
              {busy ? "Saving…" : "Save"}
            </button>
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
    <li className={`px-4 py-3 ${pendingChange ? "bg-ochre-soft/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{d.label}</p>
          {d.help && <p className="text-xs text-muted">{d.help}</p>}
        </div>
        <div className="text-end">
          <p className="font-semibold tabular-nums">{show(d, shown)}</p>
          {pendingChange && <p className="text-xs text-ochre">Now {show(d, current?.value ?? null)} · not saved</p>}
          {!pendingChange && changed && <Pill tone="sky">Added to our policy</Pill>}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {current?.source ?? "Not set"}
        {!pendingChange && changed && policy ? ` · Written policy: ${show(d, policy.value)}` : ""}
      </p>
      {admin && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {editing || pendingChange ? (
            <>
              <Editor d={d} value={shown} onChange={onChange} />
              <button type="button" onClick={() => (onDrop(), setEditing(false))} className="text-sm text-muted hover:text-clay">
                Keep as it is
              </button>
              {layerable(d) && <span className="w-full text-xs text-muted">Only stricter than our written policy ({show(d, policy?.value ?? null)}): it always applies.</span>}
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-forest hover:underline">
              {layerable(d) ? "Add a stricter requirement" : "Update"}
            </button>
          )}
          {changed && !pendingChange && !resetting && (
            <button type="button" onClick={() => setResetting(true)} className="text-sm text-muted hover:text-clay">
              Back to our written policy
            </button>
          )}
          {resetting && (
            <span className="flex w-full flex-wrap items-center gap-2">
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why" aria-label="Reason" className={`${field} min-w-0 flex-1`} />
              <button
                type="button"
                disabled={why.trim().length < 5}
                className={quietBtn}
                onClick={() =>
                  void onReset(why.trim())
                    .then(() => setResetting(false))
                    .catch(() => {})
                }
              >
                Remove the addition
              </button>
              <button type="button" onClick={() => setResetting(false)} className="text-sm text-muted">
                Cancel
              </button>
            </span>
          )}
        </div>
      )}
    </li>
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
