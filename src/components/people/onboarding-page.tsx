"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Receipt } from "@/lib/expense";
import { OWNER_LABEL, type ObAction, type StepValue } from "@/lib/onboarding";
import type { OnboardingView } from "@/app/api/onboarding/route";

/**
 * Onboarding: the new hire's checklist on their phone, and HR's and the supervisor's parts.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

async function upload(file: File, user: string | undefined): Promise<Receipt> {
  const body = new FormData();
  body.append("file", await shrink(file));
  return call<Receipt>("/api/files", user, { method: "POST", body });
}

type Step = NonNullable<OnboardingView["open"]>["steps"][number];
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";

export function OnboardingPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
  const [v, setV] = useState<OnboardingView | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [init, setInit] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("person")) setPerson(q.get("person"));
    setInit(true);
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<OnboardingView>(`/api/onboarding${person ? `?person=${person}` : ""}`, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, person]);
  useEffect(() => {
    if (init && ready && user) void load();
  }, [init, ready, user, load]);

  if (!user) return null;
  const act = async (a: ObAction, msg: string) => {
    setError("");
    try {
      const r = await call<{ view: OnboardingView }>("/api/onboarding", user.id, { method: "POST", body: JSON.stringify(a) });
      setV(r.view);
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const fmt = (iso: string) => date(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });
  const choose = (id: string) => {
    setNotice("");
    setPerson(id);
    history.replaceState(null, "", `/onboarding?person=${id}`);
  };
  const o = v?.open;
  const own = !!o && o.person === v?.me;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-3xl tracking-tight">{own ? `Welcome to Roots of Peace, ${o!.name.split(" ")[0]}` : "Onboarding"}</h1>
          <Link href="/people" className="text-sm font-semibold text-forest hover:underline">
            People
          </Link>
        </div>
        {own && <p className="mt-1 text-sm text-muted">Your first steps, all here. Each one is kept in your HR record.</p>}
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
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : (
          <>
            {v.list.filter((l) => l.person !== v.me).length > 0 && (
              <section className="mt-6">
                <SectionLabel>People starting</SectionLabel>
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {v.list
                    .filter((l) => l.person !== v.me)
                    .map((l) => (
                      <li key={l.person}>
                        <button type="button" onClick={() => choose(l.person)} className={`flex w-full items-center gap-3 px-4 py-3 text-start text-sm hover:bg-sunken ${o?.person === l.person ? "bg-sunken" : ""}`}>
                          <span className="min-w-0 flex-1 font-medium">{l.name}</span>
                          {l.mine > 0 && <Pill tone="ochre">{l.mine} for you</Pill>}
                          <span className="text-muted tabular-nums">
                            {l.progress.done} of {l.progress.total}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            )}
            {v.isHr && <StartForm v={v} act={act} />}
            {o ? (
              <Checklist key={o.person} o={o} v={v} own={!!own} fmt={fmt} act={act} />
            ) : (
              !v.list.length && <p className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No onboarding in progress.</p>
            )}
            {v.isHr && <Policies v={v} act={act} fmt={fmt} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- A checklist ---------------- */

function Checklist({ o, v, own, fmt, act }: { o: NonNullable<OnboardingView["open"]>; v: OnboardingView; own: boolean; fmt: (iso: string) => string; act: (a: ObAction, msg: string) => Promise<void> }) {
  const pct = Math.round((o.progress.done / o.progress.total) * 100);
  return (
    <section className="mt-6">
      {!own && (
        <h2 className="text-xl font-semibold">
          {o.name} <span className="text-base font-normal text-muted">· {o.title}</span>
        </h2>
      )}
      <div className="mt-2 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={o.progress.done} aria-valuemin={0} aria-valuemax={o.progress.total} aria-label="Onboarding progress">
          <div className="h-full rounded-full bg-forest" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm tabular-nums text-muted">
          {o.progress.done} of {o.progress.total} done · by {fmt(o.due)}
        </span>
      </div>
      <ol className="mt-4 space-y-3">
        {o.steps.map((s, i) => (
          <StepCard key={s.id} i={i} s={s} o={o} v={v} own={own} fmt={fmt} act={act} />
        ))}
      </ol>
    </section>
  );
}

function StepCard({ i, s, o, v, own, fmt, act }: { i: number; s: Step; o: NonNullable<OnboardingView["open"]>; v: OnboardingView; own: boolean; fmt: (iso: string) => string; act: (a: ObAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [agree, setAgree] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [details, setDetails] = useState({ phone: "", emergencyContact: "", bankAccount: "" });
  const [file, setFile] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const name = (id: string) => v.names[id] ?? id;
  const policy = s.policy ? o.policies.find((p) => p.id === s.policy) : undefined;
  const send = async (value: StepValue, msg: string) => {
    setBusy(true);
    setError("");
    try {
      await act({ action: "step", person: o.person, step: s.id, value }, msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const owner = own ? OWNER_LABEL[s.owner] : s.owner === "self" ? o.name.split(" ")[0] : s.owner === "hr" ? "HR" : `Supervisor (${name(o.supervisor)})`;
  const doc = s.kind === "sign" ? o.contract : policy?.file;
  return (
    <li className={`rounded-2xl border p-4 ${s.done ? "border-line bg-surface" : s.canDo ? "border-forest/50 bg-paper" : "border-dashed border-line bg-paper"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.done ? "bg-forest text-forest-ink" : "bg-sunken text-muted"}`} aria-hidden>
          {s.done ? "✓" : i + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.title}</p>
          <p className="text-sm text-muted">
            {s.help} <span className="whitespace-nowrap">· {owner}</span>
          </p>
          {s.done && (
            <p className="mt-1 text-sm text-leaf">
              Done by {name(s.done.by)}, {fmt(s.done.at)}
              {s.done.value?.kind === "sign" && ` · signed as “${s.done.value.typedName}”`}
              {s.done.value?.kind === "confirm" && s.done.value.note ? ` · ${s.done.value.note}` : ""}
              {s.done.value?.kind === "record" && ` · proposals #${s.done.value.proposals.join(", #")} sent for approval`}
              {s.done.value?.kind === "details" && ` · phone ${s.done.value.details.phone}`}
            </p>
          )}
          {doc && (
            <button
              type="button"
              onClick={() => {
                setOpened(true);
                void openReceipt(doc.hash, user?.id);
              }}
              className="mt-2 text-sm font-semibold text-forest hover:underline"
            >
              Open {s.kind === "sign" ? "the contract" : policy?.title} ({doc.name})
            </button>
          )}
          {s.canDo && (
            <div className="mt-3 space-y-3">
              {s.kind === "details" && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">Your phone</span>
                    <input type="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} placeholder="+93 70 000 0000" className={input} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Emergency contact: name, relation and phone</span>
                    <input value={details.emergencyContact} onChange={(e) => setDetails({ ...details, emergencyContact: e.target.value })} className={input} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Bank and account number for your salary</span>
                    <input value={details.bankAccount} onChange={(e) => setDetails({ ...details, bankAccount: e.target.value })} placeholder="Bank name, account number" className={input} />
                    <span className="mt-1 block text-xs text-muted">Seen only by you and HR. Changing it later needs the CFO and the CEO, so nobody can redirect your salary.</span>
                  </label>
                  <button type="button" disabled={busy || details.phone.trim().length < 6 || details.emergencyContact.trim().length < 6 || details.bankAccount.trim().length < 6} className={primaryBtn} onClick={() => void send({ kind: "details", details }, "Saved. HR adds them to your record.")}>
                    Save my details
                  </button>
                </>
              )}
              {s.kind === "acknowledge" && policy && (
                <>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={agree} disabled={!opened} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5" />
                    <span>
                      I have read {policy.title} (version {policy.version}) and will follow it.{!opened && <span className="block text-xs text-muted">Open it first.</span>}
                    </span>
                  </label>
                  <button type="button" disabled={busy || !agree} className={primaryBtn} onClick={() => void send({ kind: "acknowledge", file: policy.file.hash }, `Recorded: you have read ${policy.title}.`)}>
                    Confirm
                  </button>
                </>
              )}
              {s.kind === "sign" && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">Type your full name to sign</span>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={o.name} disabled={!opened} className={input} autoComplete="name" />
                    <span className="mt-1 block text-xs text-muted">{opened ? `Exactly as in your record: ${o.name}.` : "Open the contract first."} Your signature names this exact file.</span>
                  </label>
                  <button type="button" disabled={busy || typed.trim().toLowerCase() !== o.name.toLowerCase()} className={primaryBtn} onClick={() => void send({ kind: "sign", file: o.contract.hash, typedName: typed }, "Signed. Welcome aboard.")}>
                    Sign the contract
                  </button>
                </>
              )}
              {s.kind === "upload" && (
                <>
                  <label className={`${quietBtn} inline-block cursor-pointer`}>
                    {file ? `📎 ${file.name}` : busy ? "Uploading…" : "Take a photo or choose a file"}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      capture="environment"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setBusy(true);
                        setError("");
                        try {
                          setFile(await upload(f, user?.id));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>
                  <div>
                    <button type="button" disabled={busy || !file} className={primaryBtn} onClick={() => file && void send({ kind: "upload", file }, "Uploaded. Only HR can see it.")}>
                      Add to my record
                    </button>
                  </div>
                </>
              )}
              {s.kind === "confirm" && (
                <>
                  <label className="block text-sm">
                    <span className="text-muted">Note (optional)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
                  </label>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={() => void send({ kind: "confirm", ...(note.trim() ? { note } : {}) }, "Done.")}>
                    Mark done
                  </button>
                </>
              )}
              {s.kind === "record" && (
                <button type="button" disabled={busy} className={primaryBtn} onClick={() => void send({ kind: "record", proposals: [] }, "Proposed: contact details for HR approval, the bank account for the CFO and the CEO.")}>
                  Propose the details for the record
                </button>
              )}
              {error && (
                <p role="alert" className="text-sm text-clay">
                  {error}
                </p>
              )}
            </div>
          )}
          {!s.done && !s.canDo && s.kind === "record" && s.owner === "hr" && v.isHr && <p className="mt-2 text-sm text-muted">Waiting for the new hire&apos;s details.</p>}
        </div>
      </div>
    </li>
  );
}

/* ---------------- HR: start, policies ---------------- */

function StartForm({ v, act }: { v: OnboardingView; act: (a: ObAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
  const [person, setPerson] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [contract, setContract] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!v.startable.length) return null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
      <SectionLabel>Start onboarding</SectionLabel>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium">New hire</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {v.startable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (from {p.startDate})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Done by</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Contract (PDF)</span>
          <span className={`${quietBtn} mt-1 block cursor-pointer text-center`}>
            {contract ? `📎 ${contract.name}` : "Choose the contract"}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setError("");
                try {
                  setContract(await upload(f, user?.id));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !person || !contract}
        className={`${primaryBtn} mt-3`}
        onClick={async () => {
          setBusy(true);
          try {
            await act({ action: "start", person, due, contract: contract! }, "Started. The new hire sees their checklist when they sign in.");
            setPerson("");
            setContract(null);
          } catch {
            /* shown above */
          } finally {
            setBusy(false);
          }
        }}
      >
        Start
      </button>
    </section>
  );
}

function Policies({ v, act, fmt }: { v: OnboardingView; act: (a: ObAction, msg: string) => Promise<void>; fmt: (iso: string) => string }) {
  const { user } = useSession();
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<Receipt | null>(null);
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return (
    <section className="mt-10">
      <SectionLabel>Policies new hires read</SectionLabel>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
        {v.policies.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <button type="button" onClick={() => void openReceipt(p.file.hash, user?.id)} className="min-w-0 flex-1 text-start font-medium text-forest hover:underline">
              {p.title}
            </button>
            <span className="text-muted">
              version {p.version} · {fmt(p.at)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">A new version applies to onboarding started after it is published; acknowledgements already given name the version that was read.</p>
      <div className="mt-3 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Policy</span>
          <select
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value);
              setTitle(v.policies.find((p) => p.id === e.target.value)?.title ?? "");
            }}
            className={input}
          >
            <option value="">A new policy</option>
            {v.policies.map((p) => (
              <option key={p.id} value={p.id}>
                New version of {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!replace} className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026-11" className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">The document (PDF)</span>
          <span className={`${quietBtn} mt-1 block cursor-pointer text-center`}>
            {file ? `📎 ${file.name}` : "Choose the PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setError("");
                try {
                  setFile(await upload(f, user?.id));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-clay sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <button
            type="button"
            disabled={busy || title.trim().length < 3 || !version.trim() || !file}
            className={primaryBtn}
            onClick={async () => {
              setBusy(true);
              try {
                await act({ action: "policy", id: replace || slug(title), title, version, file: file! }, "Published.");
                setTitle("");
                setVersion("");
                setFile(null);
                setReplace("");
              } catch {
                /* shown above */
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish
          </button>
        </div>
      </div>
    </section>
  );
}
