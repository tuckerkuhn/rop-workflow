"use client";

/** One setup screen: a single question, with an optional hint, above its answer. */

export const field = "mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3 text-base";

export function Question({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section>
      <h1 className="font-display text-3xl leading-tight tracking-tight">{title}</h1>
      {help && <p className="mt-2 text-sm text-muted">{help}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
