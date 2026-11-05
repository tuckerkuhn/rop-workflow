"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { ACCESS_LABEL, FIELD_ROLES, LANGS, PROC_ROLES, PROJECT_ROLES, type PersonInput, type StaffAction } from "@/lib/access";
import type { PeopleView } from "@/app/api/staff/route";

/**
 * People and roles: who can sign in and what each person may do. Administrators add people,
 * give and take away roles, and turn access off; nobody changes their own roles, and every
 * change is logged. Approval roles (who signs) are set in the authority table instead.
 */

async function call<T>(user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch("/api/staff", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

type Person = PeopleView["people"][number];
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const blank: PersonInput = { name: "", title: "", email: null, kind: "employee", org: "Roots of Peace", reportsTo: null, lang: "en", project: [], field: [], fieldAccess: "none", procurement: [], procurementAccess: "none", pii: false, admin: false, leads: [] };
const strip = (p: Person): PersonInput => {
  const { id: _id, active: _a, signedIn: _s, ...rest } = p;
  void _id;
  void _a;
  void _s;
  return rest;
};

function rolesSummary(p: Person) {
  const label = (l: { id: string; label: string }[], id: string) => l.find((x) => x.id === id)?.label ?? id;
  const parts = [
    ...p.project.map((r) => label(PROJECT_ROLES, r)),
    ...p.field.map((r) => label(FIELD_ROLES, r)),
    ...p.procurement.map((r) => label(PROC_ROLES, r)),
  ];
  return parts.length ? parts.join(" · ") : "No roles";
}

export function PeopleAdminPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<PeopleView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<PeopleView>(user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  const shown = useMemo(() => (v?.people ?? []).filter((p) => (showOff || p.active) && (!q.trim() || `${p.name} ${p.title} ${p.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [v, showOff, q]);
  if (!user) return null;

  const act = async (a: StaffAction) => {
    setError("");
    setNotice("");
    try {
      const out = await call<PeopleView & { notice?: string }>(user.id, { method: "POST", body: JSON.stringify(a) });
      setV(out);
      setNotice(out.notice ?? "Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-sm">
          <Link href="/settings" className="font-semibold text-forest hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">People and roles</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Who can sign in, and what each person may do. Nobody can change their own roles, and every change is logged below. Who signs approvals (bills, payroll, purchases) is set in the{" "}
          <Link href="/people" className="font-semibold text-forest hover:underline">
            authority table
          </Link>{" "}
          instead.
        </p>
        {v?.demoMode && (
          <p className="mt-3 rounded-xl bg-ochre-soft px-4 py-3 text-sm text-ochre">
            This copy of the app runs on the demo cast, so changes here take effect on the live site (real sign-in), not on this screen&rsquo;s demo people.
          </p>
        )}
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
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <input className={`${input} mt-0 max-w-xs`} placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
                Show people whose access is off
              </label>
              <span className="flex-1" />
              {open !== "new" && (
                <button type="button" className={primaryBtn} onClick={() => setOpen("new")}>
                  Add a person
                </button>
              )}
            </div>

            {open === "new" && (
              <div className="mt-4">
                <PersonForm v={v} initial={blank} onCancel={() => setOpen(null)} onSave={(p) => act({ action: "add", person: p }).then((ok) => ok && setOpen(null))} />
              </div>
            )}

            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
              {shown.map((p) => (
                <li key={p.id} className="p-4">
                  <button type="button" className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 text-start" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{p.name}</span>
                      {p.id === v.me && <span className="ms-2 text-xs text-muted">(you)</span>}
                      <span className="block text-sm text-muted">
                        {p.title}
                        {p.kind === "donor" && ` · ${p.org}`}
                      </span>
                      <span className="mt-1 block text-xs text-muted">{rolesSummary(p)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {!p.active && <Pill tone="muted">Access off</Pill>}
                      {p.admin && <Pill tone="plum">Administrator</Pill>}
                      {p.email ? p.signedIn ? <Pill tone="forest">Has signed in</Pill> : <Pill tone="ochre">Not signed in yet</Pill> : <Pill tone="clay">No email</Pill>}
                    </span>
                  </button>
                  {open === p.id && (
                    <div className="mt-4 space-y-3">
                      <PersonForm v={v} initial={strip(p)} self={p.id === v.me} email={p.email} onCancel={() => setOpen(null)} onSave={(np) => act({ action: "update", id: p.id, person: np }).then(() => undefined)} />
                      {p.id !== v.me && (
                        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                          {p.email && !p.signedIn && v.canCreateAccounts && (
                            <button type="button" className={quietBtn} onClick={() => void act({ action: "account", id: p.id })}>
                              Create sign-in account
                            </button>
                          )}
                          {p.active ? (
                            <button type="button" className={dangerBtn} onClick={() => void act({ action: "active", id: p.id, active: false })}>
                              Turn off access
                            </button>
                          ) : (
                            <button type="button" className={quietBtn} onClick={() => void act({ action: "active", id: p.id, active: true })}>
                              Turn access back on
                            </button>
                          )}
                        </div>
                      )}
                      {p.email && !p.signedIn && !v.canCreateAccounts && (
                        <p className="text-xs text-muted">
                          To let {p.name.split(" ")[0]} sign in, add {p.email} in the Supabase dashboard (Authentication, Users, Add user). They then sign in with a code sent to that email.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {!shown.length && <li className="p-6 text-center text-sm text-muted">Nobody matches.</li>}
            </ul>

            <section className="mt-10">
              <SectionLabel>Who signs approvals</SectionLabel>
              <p className="mt-1 text-sm text-muted">
                From the authority table. Changing it needs the executive head and the board:{" "}
                <Link href="/people" className="font-semibold text-forest hover:underline">
                  propose a change
                </Link>
                .
              </p>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {v.holders.map((h) => (
                  <div key={h.role} className="flex gap-2">
                    <dt className="w-40 shrink-0 text-muted">{h.label}</dt>
                    <dd>{h.people.join(", ") || <span className="text-clay">Nobody yet</span>}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="mt-10">
              <SectionLabel>Change log</SectionLabel>
              {!v.log.length && <p className="mt-2 text-sm text-muted">No changes yet.</p>}
              <ul className="mt-2 space-y-2 text-sm">
                {v.log.map((l, k) => (
                  <li key={k} className="rounded-xl bg-sunken px-3 py-2">
                    <span className="text-muted">
                      {l.at.slice(0, 16).replace("T", " ")} · {v.people.find((p) => p.id === l.by)?.name ?? l.by} changed {v.people.find((p) => p.id === l.person)?.name ?? l.person}:
                    </span>{" "}
                    {l.changes.join("; ")}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Checks<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: { id: T; label: string; help?: string }[]; value: T[]; onChange: (v: T[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="text-sm" disabled={disabled}>
      <legend className="font-semibold">{label}</legend>
      <div className="mt-1 space-y-1">
        {options.map((o) => (
          <label key={o.id} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
            <span>
              {o.label}
              {o.help && <span className="block text-xs text-muted">{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PersonForm({ v, initial, self, email, onSave, onCancel }: { v: PeopleView; initial: PersonInput; self?: boolean; email?: string | null; onSave: (p: PersonInput) => Promise<unknown>; onCancel: () => void }) {
  const [p, setP] = useState<PersonInput>(initial);
  const [leads, setLeads] = useState(initial.leads.join(", "));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setP(initial);
    setLeads(initial.leads.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);
  const set = <K extends keyof PersonInput>(k: K, val: PersonInput[K]) => setP({ ...p, [k]: val });
  const locked = !!self;
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...p, email: p.email?.trim() ? p.email.trim() : null, leads: leads.split(",").map((x) => x.trim()).filter(Boolean) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl bg-sunken p-4">
      {locked && <p className="mb-3 text-xs text-muted">This is you: you can change your name, title and language. Another administrator changes your roles.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Full name
          <input className={input} value={p.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="text-sm">
          Job title
          <input className={input} value={p.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="text-sm">
          Email they sign in with
          <input type="email" className={input} value={p.email ?? ""} disabled={locked} onChange={(e) => set("email", e.target.value || null)} placeholder="name@rootsofpeace.org" />
          {email && p.email !== email && !locked && <span className="mt-1 block text-xs text-ochre">A new email unlinks the old sign-in.</span>}
        </label>
        <label className="text-sm">
          Reports to
          <select className={input} value={p.reportsTo ?? ""} disabled={locked} onChange={(e) => set("reportsTo", e.target.value || null)}>
            <option value="">Nobody</option>
            {v.people
              .filter((x) => x.active && x.kind === "employee")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          Staff or donor
          <select className={input} value={p.kind} disabled={locked} onChange={(e) => set("kind", e.target.value as PersonInput["kind"])}>
            <option value="employee">ROP staff</option>
            <option value="donor">Donor (sees their own reports only)</option>
          </select>
        </label>
        <label className="text-sm">
          Organization
          <input className={input} value={p.org} disabled={locked} onChange={(e) => set("org", e.target.value)} />
        </label>
        <label className="text-sm">
          Language
          <select className={input} value={p.lang} onChange={(e) => set("lang", e.target.value as PersonInput["lang"])}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Leads activities (optional)
          <input className={input} value={leads} disabled={locked} onChange={(e) => setLeads(e.target.value)} placeholder="1.1, 2.1.2 or operations" />
          <span className="mt-1 block text-xs text-muted">Their budget lines come to them on the procurement calendar.</span>
        </label>
      </div>

      {p.kind === "employee" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Checks label="Project" options={PROJECT_ROLES} value={p.project} onChange={(x) => set("project", x)} disabled={locked} />
          <div className="space-y-3">
            <label className="block text-sm font-semibold">
              Field work
              <select className={input} value={p.fieldAccess} disabled={locked} onChange={(e) => set("fieldAccess", e.target.value as PersonInput["fieldAccess"])}>
                {(["edit", "view", "none"] as const).map((x) => (
                  <option key={x} value={x}>
                    {ACCESS_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <Checks label="Field roles" options={FIELD_ROLES} value={p.field} onChange={(x) => set("field", x)} disabled={locked} />
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-semibold">
              Procurement
              <select className={input} value={p.procurementAccess} disabled={locked} onChange={(e) => set("procurementAccess", e.target.value as PersonInput["procurementAccess"])}>
                {(["edit", "view", "none"] as const).map((x) => (
                  <option key={x} value={x}>
                    {ACCESS_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <Checks label="Procurement roles" options={PROC_ROLES} value={p.procurement} onChange={(x) => set("procurement", x)} disabled={locked} />
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={p.pii} disabled={locked} onChange={(e) => set("pii", e.target.checked)} />
          <span>
            Sees participant names
            <span className="block text-xs text-muted">Everyone else, and every AI agent, sees farmer codes only.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={p.admin} disabled={locked} onChange={(e) => set("admin", e.target.checked)} />
          <span>
            Administrator
            <span className="block text-xs text-muted">Manages people and roles here, and can view the app as another person (read-only).</span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button type="button" className={primaryBtn} disabled={busy || p.name.trim().length < 2 || p.title.trim().length < 2} onClick={() => void save()}>
          {initial.name ? "Save" : "Add person"}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
