"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet } from "@/components/workspace/ledger";
import type { Receipt } from "@/lib/expense";
import type { ObAction, StepValue } from "@/lib/onboarding";
import type { OnboardingView } from "@/app/api/onboarding/route";

/**
 * Onboarding: the new hire's checklist on their phone, and HR's and the supervisor's parts.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

async function upload(file: File, user: string | undefined): Promise<Receipt> {
  const body = new FormData();
  body.append("file", await shrink(file));
  return call<Receipt>("/api/files", user, { method: "POST", body });
}

type Step = NonNullable<OnboardingView["open"]>["steps"][number];
const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
const link = "inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline";
/** People starting: the name, then how far along; on a phone they stack. */
const STARTING = "minmax(0,1fr) 8rem";

export function OnboardingPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date, tx } = useT();
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
  // The one person to look at first: the first with a step waiting for the reader.
  const forYou = v?.list.find((l) => l.person !== v.me && l.mine > 0)?.person;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <PageHead
          back={{ href: "/people", label: tx("People") }}
          title={own ? tx("Welcome to Roots of Peace, {name}", { name: o!.name.split(" ")[0] }) : tx("Starting at ROP")}
          actions={
            v &&
            (v.isHr || v.list.some((l) => l.person !== v.me)) && (
              <Link href="/offboarding" className={link}>
                {tx("Leaving and contract renewals →")}
              </Link>
            )
          }
        >
          {own && tx("Your first steps, all here. Each one is kept in your HR record.")}
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
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">{tx("Loading…")}</p>
        ) : (
          <>
            {v.list.filter((l) => l.person !== v.me).length > 0 && (
              <section>
                <SectionHead>{tx("People starting")}</SectionHead>
                <LedgerTable cols={STARTING} head={[tx("Person"), { label: tx("Steps done"), end: true }]} label={tx("People starting")}>
                  {v.list
                    .filter((l) => l.person !== v.me)
                    .map((l) => (
                      <LedgerRow key={l.person} cols="minmax(0,1fr)" onClick={() => choose(l.person)} selected={o?.person === l.person} first={l.person === forYou} className="text-sm">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem]">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span className="font-medium">{l.name}</span>
                            {l.mine > 0 && <Pill tone="ochre">{tx("{n} for you", { n: l.mine })}</Pill>}
                          </span>
                          <Fig tone="muted">{tx("{done} of {total}", { done: l.progress.done, total: l.progress.total })}</Fig>
                        </span>
                      </LedgerRow>
                    ))}
                </LedgerTable>
                {forYou && <p className="mt-2 text-xs text-muted">{tx("The shaded row has a step for you.")}</p>}
              </section>
            )}
            {v.isHr && <StartForm v={v} act={act} />}
            {o ? (
              <Checklist key={o.person} o={o} v={v} own={!!own} fmt={fmt} act={act} />
            ) : (
              <Empty className="mt-8">{v.list.length ? tx("Choose a person to see their checklist.") : tx("No onboarding in progress.")}</Empty>
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
  const { tx } = useT();
  const pct = Math.round((o.progress.done / o.progress.total) * 100);
  // The next step to do: the first one the reader can do now.
  const next = o.steps.find((s) => !s.done && s.canDo)?.id;
  return (
    <section>
      {!own && (
        <SectionHead>
          {o.name} <span className="text-base font-normal text-muted">· {o.title}</span>
        </SectionHead>
      )}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${own ? "mt-6" : "mt-3"}`}>
        <div className="h-2 min-w-32 flex-1 overflow-hidden bg-sunken" role="progressbar" aria-valuenow={o.progress.done} aria-valuemin={0} aria-valuemax={o.progress.total} aria-label={tx("Onboarding progress")}>
          <div className="h-full bg-forest" style={{ width: `${pct}%` }} />
        </div>
        <Fig tone="muted" className="text-start">
          {tx("{done} of {total} done · by {date}", { done: o.progress.done, total: o.progress.total, date: fmt(o.due) })}
        </Fig>
      </div>
      <LedgerTable cols="2.25rem minmax(0,1fr)" head={["", tx("Step")]} label={tx("Onboarding checklist")} className="mt-4">
        {o.steps.map((s, i) => (
          <StepCard key={s.id} i={i} first={s.id === next} s={s} o={o} v={v} own={own} fmt={fmt} act={act} />
        ))}
      </LedgerTable>
      {next && <p className="mt-2 text-xs text-muted">{tx("The shaded row is the next step to do.")}</p>}
    </section>
  );
}

function StepCard({ i, first, s, o, v, own, fmt, act }: { i: number; first: boolean; s: Step; o: NonNullable<OnboardingView["open"]>; v: OnboardingView; own: boolean; fmt: (iso: string) => string; act: (a: ObAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
  const { tx } = useT();
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
  const owner = own ? { self: tx("You"), hr: tx("HR"), supervisor: tx("Your supervisor") }[s.owner] : s.owner === "self" ? o.name.split(" ")[0] : s.owner === "hr" ? tx("HR") : tx("Supervisor ({name})", { name: name(o.supervisor) });
  const doc = s.kind === "sign" ? o.contract : policy?.file;
  return (
    <LedgerRow cols="minmax(0,1fr)" n={i + 1} first={first}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-xs font-semibold ${s.done ? "bg-forest text-forest-ink" : "border border-line-strong text-muted"}`} aria-hidden>
          {s.done ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${!s.done && !s.canDo ? "text-muted" : ""}`}>{s.title}</p>
          <p className="text-sm text-muted">
            {s.help} <span className="whitespace-nowrap">· {owner}</span>
          </p>
          {s.done && (
            <p className="mt-1 text-sm text-leaf">
              {tx("Done by {name}, {date}", { name: name(s.done.by), date: fmt(s.done.at) })}
              {s.done.value?.kind === "sign" && ` · ${tx("signed as “{name}”", { name: s.done.value.typedName })}`}
              {s.done.value?.kind === "confirm" && s.done.value.note ? ` · ${s.done.value.note}` : ""}
              {s.done.value?.kind === "record" && ` · ${tx("proposals {list} sent for approval", { list: `#${s.done.value.proposals.join(", #")}` })}`}
              {s.done.value?.kind === "details" && ` · ${tx("phone {phone}", { phone: s.done.value.details.phone })}`}
            </p>
          )}
          {doc && (
            <button
              type="button"
              onClick={() => {
                setOpened(true);
                void openReceipt(doc.hash, user?.id);
              }}
              className="mt-1 inline-flex min-h-11 items-center text-start text-sm font-semibold text-forest hover:underline"
            >
              {s.kind === "sign" ? tx("Open the contract ({file})", { file: doc.name }) : tx("Open {title} ({file})", { title: policy?.title ?? "", file: doc.name })}
            </button>
          )}
          {s.canDo && (
            <div className="mt-3 space-y-3">
              {s.kind === "details" && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">{tx("Your phone")}</span>
                    <input type="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} placeholder="+93 70 000 0000" className={input} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">{tx("Emergency contact: name, relation and phone")}</span>
                    <input value={details.emergencyContact} onChange={(e) => setDetails({ ...details, emergencyContact: e.target.value })} className={input} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">{tx("Bank and account number for your salary")}</span>
                    <input value={details.bankAccount} onChange={(e) => setDetails({ ...details, bankAccount: e.target.value })} placeholder={tx("Bank name, account number")} className={input} />
                    <span className="mt-1 block text-xs text-muted">{tx("Seen only by you and HR. Changing it later needs the CFO and the CEO, so nobody can redirect your salary.")}</span>
                  </label>
                  <button type="button" disabled={busy || details.phone.trim().length < 6 || details.emergencyContact.trim().length < 6 || details.bankAccount.trim().length < 6} className={primaryBtn} onClick={() => void send({ kind: "details", details }, tx("Saved. HR adds them to your record."))}>
                    {tx("Save my details")}
                  </button>
                </>
              )}
              {s.kind === "acknowledge" && policy && (
                <>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={agree} disabled={!opened} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5" />
                    <span>
                      {tx("I have read {title} (version {version}) and will follow it.", { title: policy.title, version: policy.version })}{!opened && <span className="block text-xs text-muted">{tx("Open it first.")}</span>}
                    </span>
                  </label>
                  <button type="button" disabled={busy || !agree} className={primaryBtn} onClick={() => void send({ kind: "acknowledge", file: policy.file.hash }, tx("Recorded: you have read {title}.", { title: policy.title }))}>
                    {tx("Confirm")}
                  </button>
                </>
              )}
              {s.kind === "sign" && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">{tx("Type your full name to sign")}</span>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={o.name} disabled={!opened} className={input} autoComplete="name" />
                    <span className="mt-1 block text-xs text-muted">{opened ? tx("Exactly as in your record: {name}.", { name: o.name }) : tx("Open the contract first.")} {tx("Your signature names this exact file.")}</span>
                    {opened && typed.trim() && typed.trim().toLowerCase() !== o.name.toLowerCase() && <span className="mt-1 block text-xs text-clay">{tx("The name does not match your record yet: {name}.", { name: o.name })}</span>}
                  </label>
                  <button type="button" disabled={busy || typed.trim().toLowerCase() !== o.name.toLowerCase()} className={primaryBtn} onClick={() => void send({ kind: "sign", file: o.contract.hash, typedName: typed }, tx("Signed. Welcome aboard."))}>
                    {tx("Sign the contract")}
                  </button>
                </>
              )}
              {s.kind === "upload" && (
                <>
                  <label className={`${quietBtn} inline-block cursor-pointer`}>
                    {file ? `📎 ${file.name}` : busy ? tx("Uploading…") : tx("Take a photo or choose a file")}
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
                    <button type="button" disabled={busy || !file} className={primaryBtn} onClick={() => file && void send({ kind: "upload", file }, tx("Uploaded. Only HR can see it."))}>
                      {tx("Add to my record")}
                    </button>
                  </div>
                </>
              )}
              {s.kind === "confirm" && (
                <>
                  <label className="block text-sm">
                    <span className="text-muted">{tx("Note (optional)")}</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
                  </label>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={() => void send({ kind: "confirm", ...(note.trim() ? { note } : {}) }, tx("Done."))}>
                    {tx("Mark done")}
                  </button>
                </>
              )}
              {s.kind === "record" && (
                <button type="button" disabled={busy} className={primaryBtn} onClick={() => void send({ kind: "record", proposals: [] }, tx("Proposed: contact details for HR approval, the bank account for the CFO and the CEO."))}>
                  {tx("Propose the details for the record")}
                </button>
              )}
              {error && (
                <p role="alert" className="text-sm text-clay">
                  {error}
                </p>
              )}
            </div>
          )}
          {!s.done && !s.canDo && s.kind === "record" && s.owner === "hr" && v.isHr && <p className="mt-2 text-sm text-muted">{tx("Waiting for the new hire’s details.")}</p>}
        </div>
      </div>
    </LedgerRow>
  );
}

/* ---------------- HR: start, policies ---------------- */

function StartForm({ v, act }: { v: OnboardingView; act: (a: ObAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
  const { tx } = useT();
  const [person, setPerson] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [contract, setContract] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!v.startable.length) return null;
  return (
    <section>
      <SectionHead>{tx("Start onboarding")}</SectionHead>
      <Sheet className="mt-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium">{tx("New hire")}</span>
            <select value={person} onChange={(e) => setPerson(e.target.value)} className={input}>
              <option value="">{tx("Choose…")}</option>
              {v.startable.map((p) => (
                <option key={p.id} value={p.id}>
                  {tx("{name} (from {date})", { name: p.name, date: p.startDate })}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">{tx("Done by")}</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">{tx("Contract (PDF)")}</span>
            <span className={`${quietBtn} mt-1 block min-h-11 cursor-pointer text-center`}>
              {contract ? `📎 ${contract.name}` : tx("Choose the contract")}
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
              await act({ action: "start", person, due, contract: contract! }, tx("Started. The new hire sees their checklist when they sign in."));
              setPerson("");
              setContract(null);
            } catch {
              /* shown above */
            } finally {
              setBusy(false);
            }
          }}
        >
          {tx("Start")}
        </button>
      </Sheet>
    </section>
  );
}

function Policies({ v, act, fmt }: { v: OnboardingView; act: (a: ObAction, msg: string) => Promise<void>; fmt: (iso: string) => string }) {
  const { user } = useSession();
  const { tx } = useT();
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<Receipt | null>(null);
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return (
    <section>
      <SectionHead className="mt-10">{tx("Policies new hires read")}</SectionHead>
      {v.policies.length === 0 ? (
        <Empty>{tx("No policies yet.")}</Empty>
      ) : (
        <LedgerTable cols="minmax(0,1fr) 13rem" head={[tx("Policy"), tx("Version")]} label={tx("Policies new hires read")}>
          {v.policies.map((p) => (
            <LedgerRow key={p.id} cols="minmax(0,1fr)" className="text-sm">
              <span className="flex flex-wrap items-center gap-x-3 sm:grid sm:grid-cols-[minmax(0,1fr)_13rem]">
                <button type="button" onClick={() => void openReceipt(p.file.hash, user?.id)} className="min-h-11 min-w-0 flex-1 text-start font-medium text-forest hover:underline">
                  {p.title}
                </button>
                <Fig tone="muted" className="text-start">
                  {tx("version {version} · {date}", { version: p.version, date: fmt(p.at) })}
                </Fig>
              </span>
            </LedgerRow>
          ))}
        </LedgerTable>
      )}
      <p className="mt-2 text-xs text-muted">{tx("A new version applies to onboarding started after it is published; acknowledgements already given name the version that was read.")}</p>
      <Sheet className="mt-6 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">{tx("Policy")}</span>
          <select
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value);
              setTitle(v.policies.find((p) => p.id === e.target.value)?.title ?? "");
            }}
            className={input}
          >
            <option value="">{tx("A new policy")}</option>
            {v.policies.map((p) => (
              <option key={p.id} value={p.id}>
                {tx("New version of {title}", { title: p.title })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">{tx("Title")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!replace} className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">{tx("Version")}</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026-11" className={input} />
        </label>
        <label className="text-sm">
          <span className="font-medium">{tx("The document (PDF)")}</span>
          <span className={`${quietBtn} mt-1 block min-h-11 cursor-pointer text-center`}>
            {file ? `📎 ${file.name}` : tx("Choose the PDF")}
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
                await act({ action: "policy", id: replace || slug(title), title, version, file: file! }, tx("Published."));
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
            {tx("Publish")}
          </button>
        </div>
      </Sheet>
    </section>
  );
}
