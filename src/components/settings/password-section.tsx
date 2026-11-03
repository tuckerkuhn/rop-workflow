"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { supabaseBrowser, useSession } from "@/components/app/session";
import { SectionLabel, primaryBtn } from "@/components/workspace/ui";

/** Live mode: set or change your own password, so later sign-ins skip the emailed code. */
export function PasswordSection() {
  const { mode, viewingAs } = useSession();
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (mode !== "live" || viewingAs) return null;

  const tooShort = password.length < 8;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setNote({ ok: false, text: t("settings.password.mismatch") });
    setBusy(true);
    setNote(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setNote({ ok: false, text: error.message });
    setPassword("");
    setAgain("");
    setNote({ ok: true, text: t("settings.password.saved") });
  };

  const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 text-base";
  return (
    <section className="mt-8" aria-labelledby="password-heading">
      <span id="password-heading">
        <SectionLabel>{t("settings.password.title")}</SectionLabel>
      </span>
      <p className="mt-2 text-sm text-muted">{t("settings.password.help")}</p>
      <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("settings.password.new")}
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-medium">
          {t("settings.password.again")}
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy || tooShort || !again} className={`${primaryBtn} px-5 py-2.5`}>
            {busy ? t("settings.saving") : t("settings.password.save")}
          </button>
          {password && tooShort && <span className="ms-3 text-sm text-muted">{t("settings.password.min")}</span>}
        </div>
      </form>
      {note && (
        <p role={note.ok ? "status" : "alert"} className={`mt-3 text-sm ${note.ok ? "text-forest" : "text-clay"}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}
