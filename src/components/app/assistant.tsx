"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { LockIcon, LockedFeature } from "@/components/app/locked-feature";
import { useFeature } from "@/components/app/session";
import type { MessageKey } from "@/lib/i18n";

/**
 * The AI assistant (paid plan): a button on every screen that opens a panel. For now the panel
 * is a shell; answering questions, voice and WhatsApp input come later.
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
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <p className="text-sm">{t("assistant.intro")}</p>
                <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{t("assistant.examples")}</p>
                <ul className="mt-2 space-y-2">
                  {EXAMPLES.map((k) => (
                    <li key={k} className="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted">
                      {t(k)}
                    </li>
                  ))}
                </ul>
                <p role="status" className="mt-5 rounded-xl bg-ochre-soft px-4 py-3 text-sm">
                  {t("assistant.soon")}
                </p>
              </div>
              <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-2 border-t border-line px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-3">
                <button type="button" disabled title={t("assistant.voice")} aria-label={t("assistant.voice")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted disabled:opacity-40">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-5 w-5" aria-hidden>
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
                <input disabled placeholder={t("assistant.placeholder")} aria-label={t("assistant.placeholder")} className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-base disabled:opacity-60" />
                <button type="submit" disabled aria-label={t("assistant.send")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-forest text-forest-ink disabled:opacity-40">
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
