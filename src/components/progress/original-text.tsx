"use client";

/** The Dari or Pashto a person wrote, under its English translation; marked when translation is still pending. */
const LANG = { fa: "Dari", ps: "Pashto", other: "the original language" } as const;

export function OriginalText({ original }: { original?: { lang: "fa" | "ps" | "other"; title?: string; note?: string; pending?: boolean } }) {
  if (!original || (!original.note && !original.title)) return null;
  return (
    <details className="mt-1 text-xs" open={original.pending}>
      <summary className={`cursor-pointer ${original.pending ? "font-semibold text-clay" : "text-muted"}`}>{original.pending ? "Not translated yet: written in Dari or Pashto" : `Written in ${LANG[original.lang]}: show the original`}</summary>
      <div dir="rtl" lang={original.lang === "other" ? undefined : original.lang} className="mt-1 whitespace-pre-line rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
        {original.title && <p className="font-semibold">{original.title}</p>}
        {original.note}
      </div>
    </details>
  );
}
