"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, dangerBtn, primaryBtn, quietBtn, Loading } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet } from "@/components/workspace/ledger";
import { ACCESS_LABEL, FIELD_ROLES, LANGS, PROC_ROLES, PROJECT_ROLES, ROLE_PRESETS, presetOf, type PersonInput, type StaffAction } from "@/lib/access";
import type { PeopleView } from "@/app/api/staff/route";

/**
 * People and roles: who can sign in and what each person may do. Administrators add people,
 * give and take away roles, and turn access off; nobody changes their own roles, and every
 * change is logged. Approval roles (who signs) are set in the authority table instead.
 */

async function call<T>(user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch("/api/staff", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

type Person = PeopleView["people"][number];
const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2 text-base";
/** Columns: the people list, the role holders and the change log. */
const PEOPLE_COLS = "minmax(0,1fr) auto";
const HOLDER_COLS = "minmax(0,1fr) minmax(0,1.5fr)";
const LOG_COLS = "9rem 10rem 10rem minmax(0,1fr)";
const blank: PersonInput = {
  name: "",
  title: "",
  email: null,
  kind: "employee",
  org: "Roots of Peace",
  reportsTo: null,
  lang: "en",
  project: [],
  field: [],
  fieldAccess: "none",
  procurement: [],
  procurementAccess: "none",
  pii: false,
  admin: false,
  leads: [],
  projects: [],
};
const strip = (p: Person): PersonInput => {
  const { id: _id, active: _a, signedIn: _s, invitedAt: _i, ...rest } = p;
  void _id;
  void _a;
  void _i;
  void _s;
  return rest;
};

function rolesSummary(p: Person) {
  const label = (l: { id: string; label: string }[], id: string) => l.find((x) => x.id === id)?.label ?? id;
  const parts = [...p.project.map((r) => label(PROJECT_ROLES, r)), ...p.field.map((r) => label(FIELD_ROLES, r)), ...p.procurement.map((r) => label(PROC_ROLES, r))];
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

  const shown = useMemo(
    () => (v?.people ?? []).filter((p) => (showOff || p.active) && (!q.trim() || `${p.name} ${p.title} ${p.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))),
    [v, showOff, q],
  );
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
        <PageHead back={{ href: "/settings", label: "Settings" }} title="People and roles" meta={v ? `${v.people.length} ${v.people.length === 1 ? "person" : "people"}` : undefined}>
        <p>
          Roles here decide what each person can open.{" "}
          {v?.seesRules ? (
            <>
              Who signs what (bills, payroll, purchases) is set in{" "}
              <Link href="/people?tab=rules" className="font-semibold text-forest hover:underline">
                People › Who approves what
              </Link>
              .
            </>
          ) : (
            <>Who signs what (bills, payroll, purchases) is set by HR in People › Who approves what.</>
          )}
        </p>
        <p className="mt-1">
          Who can sign in, and what each person may do. Nobody can change their own roles, and every change is logged below.
        </p>
        </PageHead>
        {v?.demoMode && (
          <p className="mt-4 bg-ochre-soft px-4 py-3 text-sm text-warn">
            This copy of the app runs on the demo cast, so changes here take effect on the live site (real sign-in), not on this screen&rsquo;s demo people.
          </p>
        )}
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
        {v && (
          <>
            <SectionHead
              aside={
                open !== "new" && (
                  <button type="button" className={primaryBtn} onClick={() => setOpen("new")}>
                    Add a person
                  </button>
                )
              }
            >
              People
            </SectionHead>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input className={`${input} mt-0 max-w-xs`} placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
                Show people whose access is off
              </label>
            </div>

            {open === "new" && (
              <div className="mt-4">
                <PersonForm v={v} initial={blank} onCancel={() => setOpen(null)} onSave={(p) => act({ action: "add", person: p }).then((ok) => ok && setOpen(null))} />
              </div>
            )}

            {!shown.length ? (
              <Empty className="mt-4">Nobody matches.</Empty>
            ) : (
              <LedgerTable cols={PEOPLE_COLS} head={["Person and roles", "Access"]} label="People" className="mt-4">
                {/* Each row opens its own form under it, so the row is a button that says whether it is open (not a LedgerRow). */}
                {shown.map((p) => (
                  <div key={p.id} role="row" className={`border-b ${open === p.id ? "border-ink" : "border-line"}`}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-start hover:bg-ochre-soft focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest"
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                      aria-expanded={open === p.id}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-bold">{p.name}</span>
                        {p.id === v.me && <span className="ms-2 text-xs text-muted">(you)</span>}
                        <span className="block text-sm text-muted">
                          {p.title}
                          {p.kind === "donor" && ` · ${p.org}`}
                        </span>
                        <span className="mt-1 block text-xs text-muted">{rolesSummary(p)}</span>
                      </span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {!p.active && <Pill tone="muted">Access off</Pill>}
                        {p.admin && <Pill tone="plum">Administrator</Pill>}
                        {p.email ? (
                          p.signedIn ? (
                            <Pill tone="forest">Has signed in</Pill>
                          ) : (
                            <Pill tone="ochre">{p.invitedAt ? `Invited ${p.invitedAt.slice(0, 10)}, not signed in yet` : "Not signed in yet"}</Pill>
                          )
                        ) : (
                          <Pill tone="clay">No email</Pill>
                        )}
                      </span>
                    </button>
                    {open === p.id && (
                      <div className="space-y-3 px-3 pb-4">
                        <PersonForm
                          v={v}
                          initial={strip(p)}
                          hrSupervisor={v.supervisors[p.id]}
                          self={p.id === v.me}
                          email={p.email}
                          onCancel={() => setOpen(null)}
                          onSave={(np) => act({ action: "update", id: p.id, person: np }).then(() => undefined)}
                        />
                        {p.id !== v.me && (
                          <div className="flex flex-wrap gap-2 border-t border-ink pt-3">
                            {p.email && !p.signedIn && p.active && v.canCreateAccounts && (
                              <button type="button" className={primaryBtn} onClick={() => void act({ action: "invite", id: p.id })}>
                                {p.invitedAt ? "Send the invitation again" : "Send an invitation"}
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
                  </div>
                ))}
              </LedgerTable>
            )}

            <section>
              <SectionHead className="mt-10">Who signs approvals</SectionHead>
              <p className="mt-1 text-sm text-muted">
                From the authority table. Changing it needs the executive head and the board
                {v.seesRules ? (
                  <>
                    :{" "}
                    <Link href="/people?tab=rules" className="font-semibold text-forest hover:underline">
                      propose a change
                    </Link>
                    .
                  </>
                ) : (
                  <>; HR proposes changes in People › Who approves what.</>
                )}
              </p>
              <LedgerTable cols={HOLDER_COLS} head={["Role", "Held by"]} label="Who signs approvals">
                {v.holders.map((h) => (
                  <LedgerRow key={h.role} cols={HOLDER_COLS} className="text-sm">
                    <span className="text-muted">{h.label}</span>
                    <span>{h.people.join(", ") || <span className="text-clay">Nobody yet</span>}</span>
                  </LedgerRow>
                ))}
              </LedgerTable>
            </section>

            <section>
              <SectionHead className="mt-10">Change log</SectionHead>
              {!v.log.length ? (
                <Empty>No changes yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <LedgerTable cols={LOG_COLS} head={["When", "By", "Person", "What changed"]} label="Change log" className="mt-3 min-w-[44rem]">
                    {v.log.map((l, k) => (
                      <LedgerRow key={k} cols={LOG_COLS} className="text-sm">
                        <Fig className="text-start" tone="muted">
                          {l.at.slice(0, 16).replace("T", " ")}
                        </Fig>
                        <span>{v.people.find((p) => p.id === l.by)?.name ?? l.by}</span>
                        <span className="font-semibold">{v.people.find((p) => p.id === l.person)?.name ?? l.person}</span>
                        <span>{l.changes.join("; ")}</span>
                      </LedgerRow>
                    ))}
                  </LedgerTable>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Checks<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { id: T; label: string; help?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="text-sm" disabled={disabled}>
      <legend className="font-bold">{label}</legend>
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

function PersonForm({
  v,
  initial,
  self,
  email,
  hrSupervisor,
  onSave,
  onCancel,
}: {
  v: PeopleView;
  initial: PersonInput;
  /** Who this person reports to on the HR record, when they have one: shown here, changed there. */
  hrSupervisor?: string;
  self?: boolean;
  email?: string | null;
  onSave: (p: PersonInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [p, setP] = useState<PersonInput>(initial);
  const [leads, setLeads] = useState(initial.leads.join(", "));
  const [projects, setProjects] = useState<string[]>(initial.projects ?? []);
  const [busy, setBusy] = useState(false);
  // Every project in the organization to pick from, by name (sample and sandboxes included). The person's record keeps the project codes.
  const allProjects = v.projects;
  const projectOptions = [
    ...allProjects.map((x) => ({ id: x.id, label: x.name, help: x.kind === "real" ? x.id : `${x.id} · ${x.kind}` })),
    // A code saved earlier that is not in the list any more stays on the record, ticked, until unticked.
    ...projects.filter((c) => !allProjects.some((x) => x.id === c)).map((c) => ({ id: c, label: c, help: "Not in the project list" })),
  ];
  useEffect(() => {
    setP(initial);
    setLeads(initial.leads.join(", "));
    setProjects(initial.projects ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);
  const set = <K extends keyof PersonInput>(k: K, val: PersonInput[K]) => setP({ ...p, [k]: val });
  const locked = !!self;
  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        ...p,
        email: p.email?.trim() ? p.email.trim() : null,
        leads: leads
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        projects: projects.map((x) => x.trim().toUpperCase()).filter(Boolean),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className="">
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
          {email && p.email !== email && !locked && <span className="mt-1 block text-xs text-warn">A new email unlinks the old sign-in.</span>}
        </label>
        <label className="text-sm">
          Reports to
          <select className={input} value={hrSupervisor ?? p.reportsTo ?? ""} disabled={locked || !!hrSupervisor} onChange={(e) => set("reportsTo", e.target.value || null)}>
            <option value="">Nobody</option>
            {v.people
              .filter((x) => x.active && x.kind === "employee")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          {hrSupervisor && <span className="mt-1 block text-xs text-muted">Set on the HR record, so it is changed there and nowhere else. Approvals follow it.</span>}
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
          Activities this person leads (optional)
          <input className={input} value={leads} disabled={locked} onChange={(e) => setLeads(e.target.value)} placeholder="For example: 1.1, 2.1.2" />
          <span className="mt-1 block text-xs text-muted">
            The activity numbers from the project&rsquo;s workplan, separated by commas, for example &ldquo;1.1, 2.1.2&rdquo;. Write &ldquo;operations&rdquo; for running costs. The budget lines for these activities then come to this person on the procurement calendar.
          </span>
        </label>
        <div className="text-sm sm:col-span-2">
          <Checks label="Projects (optional)" options={projectOptions} value={projects} onChange={setProjects} disabled={locked} />
          <span className="mt-1 block text-xs text-muted">Their roles apply only on the projects ticked. Tick none for every project. Donors should always have their projects ticked.</span>
          {projectOptions.length === 0 && <span className="mt-1 block text-xs text-muted">No projects yet.</span>}
        </div>
      </div>

      {p.kind === "employee" && (
        <div className="mt-4">
          <p className="font-mono text-xs text-muted">Role</p>
          <div role="radiogroup" aria-label="Role" className="mt-1 grid gap-2 sm:grid-cols-4">
            {ROLE_PRESETS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={presetOf(p) === r.id}
                disabled={locked}
                onClick={() => setP({ ...p, ...r.set, project: [...r.set.project] })}
                className={`min-h-11 border px-3 py-2 text-start text-sm ${presetOf(p) === r.id ? "border-2 border-forest bg-ochre-soft font-bold" : "border-line bg-paper hover:border-forest"}`}
              >
                {r.label}
                <span className="mt-0.5 block text-xs font-normal text-muted">{r.help}</span>
              </button>
            ))}
          </div>
          {!presetOf(p) && <p className="mt-1 text-xs text-muted">Custom access: set below.</p>}
        </div>
      )}

      {p.kind === "employee" && (
        <details className="mt-3" open={!presetOf(initial)}>
          <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs text-muted">Fine-tune access</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
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
        </details>
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
    </Sheet>
  );
}
