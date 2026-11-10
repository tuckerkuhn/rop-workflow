"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { canEditProject } from "@/lib/demo";
import { setProcurementRules } from "@/lib/procurement";
import { GapPanel } from "@/components/settings/gap-panel";
import { DEPARTMENTS, layered, show, type Area, type Cited, type Line, type ParamDef, type Value } from "@/lib/policy";
import type { PolicyView } from "@/app/api/projects/[code]/policy/route";

/**
 * The rules a project follows: choose the donor, see each rule with both sources and why the
 * project follows the value it does, and (administrators) decide conflicts.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const AREAS: Area[] = DEPARTMENTS;
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";

export function PolicyPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<PolicyView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const url = `/api/projects/${project.id}/policy`;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<PolicyView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);

  if (!user) return null;
  const post = async (body: object, msg: string) => {
    setError("");
    try {
      const next = await call<PolicyView>(url, user.id, { method: "POST", body: JSON.stringify(body) });
      setV(next);
      // Procurement follows the new rules straight away; an undecided conflict keeps the organization's value.
      setProcurementRules(Object.fromEntries(next.lines.filter((l) => !l.conflict || l.decision).map((l) => [l.key, l.value])));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const mayChoose = canEditProject(user) || !!user.admin;
  const def = (k: string) => v?.params.find((p) => p.key === k) as ParamDef;
  const open = v ? v.lines.filter((l) => v.open.includes(l.key)) : [];
  const gaps = v ? v.lines.filter((l) => v.gaps.includes(l.key)) : [];

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Rules this project follows</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The organization&apos;s own procedures always apply. Where the donor requires more, it shows as a gap; once approved, the donor&apos;s requirement is layered on for this project. Where nothing satisfies both, an administrator decides. Every approval and decision is kept.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/settings" className="font-semibold text-forest hover:underline">
            Project settings
          </Link>
        </p>
        {!project.saved && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Choose a project saved in the database (for example ACRP) to set its rules.</p>}
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
        {v && (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-surface p-4">
                <SectionLabel>Organization</SectionLabel>
                <p className="mt-1 font-semibold">{v.org.name}</p>
                <p className="mt-1 text-sm text-muted">{v.org.summary}</p>
                <Docs docs={v.org.documents} />
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <SectionLabel>Donor</SectionLabel>
                {mayChoose ? (
                  <select
                    value={v.setting.donor ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "custom") setCustomOpen(true);
                      else void post({ action: "choose", donor: e.target.value || null }, "Donor rules updated.").catch(() => {});
                    }}
                    className={input}
                    aria-label="Donor"
                  >
                    <option value="">None: the organization&apos;s policy only</option>
                    {v.donors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    <option value="custom">{v.setting.custom ? `Custom: ${v.setting.custom.name}` : "Another donor (enter its rules)"}</option>
                  </select>
                ) : (
                  <p className="mt-1 font-semibold">{v.donor?.name ?? "None"}</p>
                )}
                {v.donor && <p className="mt-2 text-sm text-muted">{v.donor.summary}</p>}
                {v.donor && <Docs docs={v.donor.documents} />}
                {mayChoose && (
                  <Link href="/setup?step=deadlines" className="mt-2 inline-block text-sm font-semibold text-forest hover:underline">
                    Read the deadlines and rules from the signed agreement →
                  </Link>
                )}
                {v.setting.chosenBy && (
                  <p className="mt-2 text-xs text-muted">
                    Chosen by {v.setting.chosenBy.name}, {v.setting.chosenBy.at}
                  </p>
                )}
                {v.setting.donor === "custom" && mayChoose && (
                  <button type="button" className={`${quietBtn} mt-2`} onClick={() => setCustomOpen(true)}>
                    Edit the custom donor&apos;s rules
                  </button>
                )}
              </div>
            </section>

            {v.setting.agreement && v.setting.agreement.terms.length > 0 && (
              <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
                <SectionLabel>Other agreement terms</SectionLabel>
                <p className="mt-1 text-sm text-muted">From the signed agreement, confirmed in setup. The app does not check these: they are here for the team to follow.</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {v.setting.agreement.terms.map((x) => (
                    <li key={x.text}>
                      {x.text} <span className="text-xs text-muted">({x.source})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {customOpen && <CustomForm v={v} onClose={() => setCustomOpen(false)} save={(name, values) => post({ action: "custom", name, values }, "Custom donor rules saved.").then(() => setCustomOpen(false))} />}

            {open.length > 0 && (
              <section className="mt-6 rounded-2xl border border-clay bg-clay-soft p-4">
                <p className="font-semibold text-clay">
                  {open.length} {open.length === 1 ? "conflict needs" : "conflicts need"} a decision
                </p>
                <p className="mt-1 text-sm text-clay">No value satisfies both policies. {user.admin ? "Decide each one; your reason is kept." : "An administrator has been asked to decide; until then, check with them before acting on these rules."}</p>
                <div className="mt-3 space-y-3">
                  {open.map((l) => (
                    <Conflict key={l.key} l={l} def={def(l.key)} admin={!!user.admin} decide={(value, reason) => post({ action: "decide", key: l.key, value, reason }, "Decision recorded.")} />
                  ))}
                </div>
              </section>
            )}

            {gaps.length > 0 && (
              <GapPanel
                key={gaps.map((g) => g.key).join(",")}
                title={`${gaps.length} donor ${gaps.length === 1 ? "requirement goes" : "requirements go"} beyond our procedures`}
                intro={`Until approved, this project follows ${v.org.name}'s own procedures on these. Approve the ones to layer on for this project.`}
                items={gaps.map((l) => ({
                  key: l.key,
                  label: def(l.key).label,
                  ours: show(def(l.key), l.org?.value ?? null),
                  required: show(def(l.key), l.donor!.value),
                  result: show(def(l.key), layered(def(l.key), l.org?.value ?? null, l.donor!.value)),
                  source: l.donor!.source,
                }))}
                canApprove={mayChoose}
                cannot="The project manager or an administrator approves these."
                onApprove={(keys, reason) => post({ action: "approve", keys, reason }, `${keys.length} donor ${keys.length === 1 ? "requirement" : "requirements"} layered on.`)}
              />
            )}

            {AREAS.map((area) => {
              const lines = v.lines.filter((l) => def(l.key)?.area === area);
              return (
                <section key={area} className="mt-8">
                  <SectionLabel>{area}</SectionLabel>
                  <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
                    <table className="w-full min-w-[44rem] text-sm">
                      <thead className="text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2 text-start font-medium">Rule</th>
                          <th className="px-3 py-2 text-start font-medium">{v.org.name}</th>
                          <th className="px-3 py-2 text-start font-medium">{v.donor?.name ?? "Donor"}</th>
                          <th className="px-3 py-2 text-start font-medium">This project follows</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line align-top">
                        {lines.map((l) => (
                          <Row key={l.key} l={l} d={def(l.key)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            {v.setting.history.length > 0 && (
              <section className="mt-8">
                <SectionLabel>Decisions</SectionLabel>
                <ul className="mt-2 space-y-1 text-sm">
                  {[...v.setting.history].reverse().map((h, i) => (
                    <li key={i}>
                      {h.at}: {def(h.key)?.label} {"layered" in h && h.layered ? "— the donor's requirement layered on" : `set to ${show(def(h.key), h.value)}`} by {h.name}. <span className="text-muted">{h.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Docs({ docs }: { docs: { title: string; where: string }[] }) {
  if (!docs.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted">
      {docs.map((d) => (
        <li key={d.title}>
          {d.title} <span className="opacity-75">({d.where})</span>
        </li>
      ))}
    </ul>
  );
}

function Cell({ c, d }: { c: Cited | null; d: ParamDef }) {
  if (!c) return <span className="text-muted">—</span>;
  return (
    <>
      <span>{show(d, c.value)}</span>
      <span className="block text-xs text-muted">
        {c.source}
        {c.confidence && c.confidence !== "documented" ? ` · ${c.confidence}` : ""}
      </span>
    </>
  );
}

function Row({ l, d }: { l: Line; d: ParamDef }) {
  return (
    <tr className={l.conflict && !l.decision ? "bg-clay-soft/50" : ""}>
      <td className="px-3 py-2">
        {d.label}
        {d.help && <span className="block text-xs text-muted">{d.help}</span>}
      </td>
      <td className="px-3 py-2">
        <Cell c={l.org} d={d} />
      </td>
      <td className="px-3 py-2">
        <Cell c={l.donor} d={d} />
      </td>
      <td className="px-3 py-2">
        <span className="font-semibold">{l.conflict && !l.decision ? "To decide" : show(d, l.value)}</span>
        {l.gap && (
          <span className="ms-2">
            <Pill tone="ochre">Gap: approve above</Pill>
          </span>
        )}
        <span className="block text-xs text-muted">{l.conflict && !l.decision ? l.conflict : l.why}</span>
        {(l.org?.confidence === "to verify" || l.donor?.confidence === "to verify") && <Pill tone="ochre">To verify</Pill>}
      </td>
    </tr>
  );
}

function Conflict({ l, def, admin, decide }: { l: Line; def: ParamDef; admin: boolean; decide: (value: Value, reason: string) => Promise<void> }) {
  const [choice, setChoice] = useState<"org" | "donor" | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl border border-clay/40 bg-paper p-3 text-sm">
      <p className="font-semibold">{def.label}</p>
      <p className="mt-1 text-muted">{l.conflict}</p>
      {admin && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-4">
            {l.org && (
              <label className="flex items-center gap-2">
                <input type="radio" name={`c-${l.key}`} checked={choice === "org"} onChange={() => setChoice("org")} />
                Organization: {show(def, l.org.value)}
              </label>
            )}
            {l.donor && (
              <label className="flex items-center gap-2">
                <input type="radio" name={`c-${l.key}`} checked={choice === "donor"} onChange={() => setChoice("donor")} />
                Donor: {show(def, l.donor.value)}
              </label>
            )}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (for example: confirmed with the donor's grant officer on…)" className={input} aria-label="Reason" />
          <button
            type="button"
            disabled={busy || !choice || reason.trim().length < 5}
            className={primaryBtn}
            onClick={async () => {
              setBusy(true);
              try {
                await decide(choice === "org" ? l.org!.value : l.donor!.value, reason);
              } catch {
                /* shown above */
              } finally {
                setBusy(false);
              }
            }}
          >
            Decide
          </button>
        </div>
      )}
    </div>
  );
}

function CustomForm({ v, onClose, save }: { v: PolicyView; onClose: () => void; save: (name: string, values: Record<string, Cited>) => Promise<void> }) {
  const start = v.setting.custom;
  const [name, setName] = useState(start?.name ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(start?.values ?? {}).map(([k, c]) => [k, Array.isArray(c.value) ? c.value.join("; ") : c.value == null ? "" : String(c.value)])));
  const [source, setSource] = useState(start ? (Object.values(start.values)[0]?.source ?? "") : "");
  const [busy, setBusy] = useState(false);
  const parse = (d: ParamDef, s: string): Value => {
    if (s.trim() === "") return null;
    if (d.unit) return Number(s);
    if (d.merge === "any") return s === "yes";
    if (d.merge === "union" || d.merge === "common") return s.split(";").map((x) => x.trim()).filter(Boolean);
    return s.trim();
  };
  return (
    <section className="mt-6 rounded-2xl border border-forest/40 bg-paper p-4">
      <SectionLabel>Another donor&apos;s rules</SectionLabel>
      <p className="mt-1 text-sm text-muted">Fill in only what the donor&apos;s agreement or policy says; leave the rest empty and the organization&apos;s policy applies. Lists are separated with semicolons.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Donor</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Where these rules come from</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Grant agreement, annex B, 2026" className={input} />
        </label>
        {v.params.map((d) => (
          <label key={d.key} className="text-sm">
            <span className="font-medium">
              {d.label}
              {d.unit ? ` (${d.unit})` : ""}
            </span>
            {d.merge === "any" ? (
              <select value={vals[d.key] ?? ""} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })} className={input}>
                <option value="">Not set</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <input type={d.unit ? "number" : "text"} value={vals[d.key] ?? ""} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })} className={input} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || name.trim().length < 2 || source.trim().length < 3}
          className={primaryBtn}
          onClick={async () => {
            setBusy(true);
            try {
              const values: Record<string, Cited> = {};
              for (const d of v.params) {
                const val = parse(d, vals[d.key] ?? "");
                if (val !== null && !(Array.isArray(val) && !val.length)) values[d.key] = { value: val, source };
              }
              await save(name, values);
            } catch {
              /* shown above */
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}
