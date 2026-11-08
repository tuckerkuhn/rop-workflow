"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { LockIcon, LockedFeature } from "@/components/app/locked-feature";
import Link from "next/link";
import { useFeature, useSession } from "@/components/app/session";
import type { MessageKey } from "@/lib/i18n";

/**
 * The AI assistant (paid plan): a button on every screen that opens a panel where staff ask
 * about the current project. Answers come from the project's own records (server/assistant.ts),
 * with links to where to act. Voice and WhatsApp input come later.
 */

const EXAMPLES: MessageKey[] = ["assistant.ex.late", "assistant.ex.noData", "assistant.ex.report"];

function Sparkle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5Z" />
    </svg>
  );
}

export function Assistant() {
  const { t } = useT();
  const { project } = useCurrentProject();
  const allowed = useFeature("ai_assistant");
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a: string | null; error?: string; links: { label: string; href: string }[]; followUps: string[] }[]>([]);
  // A new project is a new conversation.
  useEffect(() => setTurns([]), [project.id]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);
  const send = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || busy || !user) return;
    setQ("");
    setBusy(true);
    const history = turns.filter((x) => x.a).map((x) => ({ q: x.q, a: x.a! }));
    setTurns((all) => [...all, { q: text, a: null, links: [], followUps: [] }]);
    try {
      const res = await fetch(`/api/projects/${project.id}/assistant`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify({ question: text, history }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No answer.");
      setTurns((all) => all.map((x, i) => (i === all.length - 1 ? { ...x, a: d.answer, links: d.links, followUps: d.followUps } : x)));
    } catch (e) {
      setTurns((all) => all.map((x, i) => (i === all.length - 1 ? { ...x, a: "", error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  // Focus moves into the panel on open and back to the button on close.
  useEffect(() => {
    if (open) closer.current?.focus();
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        aria-label={t("assistant.open")}
        title={t("assistant.name")}
        className={`fixed end-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-forest text-forest-ink shadow-[0_12px_24px_-10px_rgb(31_77_54/0.8)] transition hover:-translate-y-0.5 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:end-6 lg:bottom-6 ${open ? "hidden lg:grid" : ""}`}
      >
        <Sparkle className="h-6 w-6" />
        {!allowed && (
          <span className="absolute -end-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ochre text-white" aria-hidden>
            <LockIcon />
          </span>
        )}
      </button>

      {open && (
        <section
          id="assistant-panel"
          role="dialog"
          aria-labelledby="assistant-title"
          className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col rounded-t-2xl border border-line bg-paper shadow-[0_-20px_40px_-20px_rgb(19_32_26/0.5)] lg:inset-x-auto lg:end-6 lg:top-auto lg:bottom-24 lg:h-[min(620px,75vh)] lg:w-[400px] lg:rounded-2xl"
        >
          <header className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-forest">
              <Sparkle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="assistant-title" className="font-display text-xl">
                {t("assistant.name")}
              </h2>
              <p className="truncate text-xs text-muted">{t("assistant.for", { project: project.name })}</p>
            </div>
            <button ref={closer} type="button" onClick={() => setOpen(false)} aria-label={t("assistant.close")} className="grid h-11 w-11 place-items-center rounded-full text-xl text-muted hover:bg-sunken hover:text-ink">
              ×
            </button>
          </header>

          {allowed ? (
            <>
              <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-5" aria-live="polite">
                {!turns.length && (
                  <>
                    <p className="text-sm">{t("assistant.intro")}</p>
                    <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{t("assistant.examples")}</p>
                    <ul className="mt-2 space-y-2">
                      {EXAMPLES.map((k) => (
                        <li key={k}>
                          <button type="button" onClick={() => void send(t(k))} className="w-full rounded-xl border border-line px-3 py-2 text-start text-sm hover:border-forest">
                            {t(k)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {turns.map((x, i) => (
                  <div key={i} className="mb-5">
                    <p className="ms-8 rounded-2xl bg-mist px-3 py-2 text-sm">{x.q}</p>
                    {x.a === null ? (
                      <p className="mt-2 text-sm text-muted">{t("assistant.thinking")}</p>
                    ) : x.error ? (
                      <p className="mt-2 rounded-xl bg-clay-soft px-3 py-2 text-sm text-clay">{x.error}</p>
                    ) : (
                      <div className="mt-2">
                        <p className="whitespace-pre-line text-sm leading-relaxed">{x.a}</p>
                        {x.links.length > 0 && (
                          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                            {x.links.map((l) => (
                              <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)} className="font-semibold text-forest hover:underline">
                                {l.label} →
                              </Link>
                            ))}
                          </p>
                        )}
                        {i === turns.length - 1 && x.followUps.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {x.followUps.map((f) => (
                              <button key={f} type="button" onClick={() => void send(f)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-forest">
                                {f}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {turns.length > 0 && <p className="text-[11px] text-muted">{t("assistant.note")}</p>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(q);
                }}
                className="flex items-center gap-2 border-t border-line px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-3"
              >
                <input value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} placeholder={t("assistant.placeholder")} aria-label={t("assistant.placeholder")} className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-base disabled:opacity-60" />
                <button type="submit" disabled={busy || q.trim().length < 3} aria-label={t("assistant.send")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-forest text-forest-ink disabled:opacity-40">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 rtl:-scale-x-100" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 py-8">
              <LockedFeature feature={t("assistant.name")} why={t("plan.assistantWhy")} />
            </div>
          )}
        </section>
      )}
    </>
  );
}
