"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useCallback, useEffect, useState } from "react";

/**
 * Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator,
 * 1Password…), through Supabase's TOTP factors. The gate stands in for the whole app while the
 * second step is owed; the settings section lets anyone set one up or remove it.
 */

const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const field = "mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-forest";
const button = "mt-4 w-full rounded-full bg-forest px-4 py-3 font-semibold text-paper transition disabled:opacity-50";
const message = (e: { message: string } | null | undefined) => (e ? (/invalid|expired/i.test(e.message) ? "That code is wrong or has expired: use the code showing now." : e.message) : "");

/** Set up an authenticator: scan the code, then enter the six digits it shows. */
function Enroll({ onDone }: { onDone: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      const sb = client();
      // A setup left half-done earlier blocks a new one: clear unverified factors first.
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (!live) return;
      if (error || !data) return setError(error?.message ?? "Could not start the set-up.");
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      live = false;
    };
  }, []);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factor) return;
    setBusy(true);
    const { error } = await client().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (error) return setError(message(error));
    onDone();
  };
  return (
    <div>
      <p className="text-sm">Open your authenticator app, add an account, and scan this code. Then enter the six digits it shows.</p>
      {factor ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={factor.qr} alt="QR code to scan with an authenticator app" className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2" />
          <p className="mt-2 text-center text-xs text-muted">
            Can&rsquo;t scan? Enter this key: <span className="select-all font-mono">{factor.secret}</span>
          </p>
        </>
      ) : (
        !error && <p className="mt-4 text-sm text-muted">Preparing…</p>
      )}
      <form onSubmit={verify}>
        <input className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Six-digit code" />
        {error && (
          <p role="alert" className="mt-2 text-sm text-clay">
            {error}
          </p>
        )}
        <button type="submit" className={button} disabled={busy || code.length !== 6 || !factor}>
          Turn on two-step sign-in
        </button>
      </form>
    </div>
  );
}

/** Enter the code from the authenticator already set up. */
function Verify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const sb = client();
    const { data } = await sb.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) {
      setBusy(false);
      return setError("No authenticator is set up for this account. Ask an administrator.");
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (error) return setError(message(error));
    onDone();
  };
  return (
    <form onSubmit={verify}>
      <p className="text-sm">Enter the six-digit code from your authenticator app.</p>
      <input className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Six-digit code" />
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      <button type="submit" className={button} disabled={busy || code.length !== 6}>
        Continue
      </button>
    </form>
  );
}

/** Stands in for the app until the second step is done. */
export function TwoStepGate({ kind, onDone }: { kind: "verify" | "enroll"; onDone: () => void }) {
  const signOut = async () => {
    await client().auth.signOut();
    window.location.href = "/";
  };
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-display text-2xl">{kind === "verify" ? "One more step" : "Set up two-step sign-in"}</h1>
        {kind === "enroll" && <p className="mt-1 text-sm text-muted">Your organization now requires a code from an authenticator app as well as your password or emailed code.</p>}
        <div className="mt-4">{kind === "verify" ? <Verify onDone={onDone} /> : <Enroll onDone={onDone} />}</div>
        <button type="button" onClick={() => void signOut()} className="mt-4 w-full text-sm text-muted hover:text-ink">
          Sign out
        </button>
      </div>
    </main>
  );
}

/** Settings: see whether two-step sign-in is on, set it up, or remove it. */
export function TwoStepSettings() {
  const [factors, setFactors] = useState<{ id: string; name: string }[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await client().auth.mfa.listFactors();
    if (error) return setError(error.message);
    setFactors((data?.totp ?? []).filter((f) => f.status === "verified").map((f) => ({ id: f.id, name: f.friendly_name ?? "Authenticator" })));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const remove = async (id: string) => {
    const { error } = await client().auth.mfa.unenroll({ factorId: id });
    if (error) return setError(/aal2|assurance/i.test(error.message) ? "Sign out and back in with your code first, then remove it." : error.message);
    await load();
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-xl">Two-step sign-in</h2>
      <p className="mt-1 text-sm text-muted">A code from an authenticator app on your phone, as well as your password or emailed code. It protects pay, bank details and the HR record if a password is stolen.</p>
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
      {factors === null ? (
        <p className="mt-3 text-sm text-muted">Checking…</p>
      ) : factors.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {factors.map((f) => (
            <li key={f.id} className="flex items-center gap-3">
              <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-semibold text-forest">On</span>
              <span className="flex-1">{f.name}</span>
              <button type="button" className="text-sm text-muted hover:text-clay" onClick={() => void remove(f.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : adding ? (
        <div className="mt-3 max-w-sm">
          <Enroll
            onDone={() => {
              setAdding(false);
              void load();
            }}
          />
        </div>
      ) : (
        <button type="button" className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper" onClick={() => setAdding(true)}>
          Set up two-step sign-in
        </button>
      )}
    </section>
  );
}
