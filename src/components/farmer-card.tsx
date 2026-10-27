/** Hero visual: one synthetic farmer answering the MVP's three questions. */

const timeline = [
  { date: "12 Feb", label: "Land-prep training attended", tone: "ok" },
  { date: "02 Mar", label: "Readiness: No · ridges not to spec", tone: "no" },
  { date: "09 Mar", label: "Recheck after correction: Yes", tone: "ok" },
  { date: "11 Mar", label: "Inputs distributed · linked to budget line 2.1", tone: "ok" },
] as const;

export function FarmerCard() {
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-[0_40px_80px_-40px_rgb(19_32_26/0.45)]">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-mist font-display text-forest">AW</div>
            <div>
              <p className="text-sm font-semibold">Farmer F-0009</p>
              <p className="text-xs text-muted">Village B · Maize · 0.8 ha · 2027 Long Rains</p>
            </div>
          </div>
          <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-leaf">Enrolled</span>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Ready for inputs?</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-leaf text-white">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="font-display text-xl">Yes, after recheck</span>
            </div>
          </section>

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">What happened?</p>
            <ol className="relative mt-3 space-y-3">
              <span aria-hidden className="absolute bottom-1.5 left-[5px] top-1.5 w-px bg-line" />
              {timeline.map((t) => (
                <li key={t.date} className="relative flex items-baseline gap-3 text-sm">
                  <span
                    className={`relative top-0.5 h-[11px] w-[11px] shrink-0 rounded-full ring-[3px] ring-surface ${
                      t.tone === "no" ? "bg-clay" : "bg-leaf"
                    }`}
                  />
                  <span className="w-12 shrink-0 font-mono text-[11px] text-muted">{t.date}</span>
                  <span>{t.label}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl bg-ochre-soft px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ochre">Needs action</p>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-medium">Planting follow-up visit</span>
              <span className="font-mono text-xs text-muted">Eli · Extension · due 25 Mar</span>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-line bg-paper/60 px-6 py-3">
          {["kobo · a3f2…9c1", "paper · field office binder 1", "expense · 2.1-0009"].map((e) => (
            <span key={e} className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[10.5px] text-muted">
              {e}
            </span>
          ))}
        </div>
      </div>

      <div
        className="rise absolute -bottom-12 -left-5 hidden items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_20px_40px_-24px_rgb(19_32_26/0.5)] sm:flex"
        style={{ animationDelay: "900ms" }}
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-leaf" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-semibold">Kobo submission synced</p>
          <p className="text-[11px] text-muted">Recorded offline · linked to P-0009</p>
        </div>
      </div>
    </div>
  );
}
