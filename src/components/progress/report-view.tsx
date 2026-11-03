"use client";

import type { ReportDoc } from "@/lib/report-formats";

/** A built report as it will be exported, shown in the page. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <article className="rounded-2xl border border-line bg-surface px-5 py-6 sm:px-8">
      <header className="border-b-2 border-ink pb-3">
        <h3 className="font-display text-2xl tracking-tight">{doc.title}</h3>
        <p className="text-sm text-muted">{doc.subtitle}</p>
      </header>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {doc.meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm">{doc.summary}</p>
      {doc.tables.map((tbl) => (
        <section key={tbl.heading} className="mt-6">
          <h4 className="font-display text-lg">{tbl.heading}</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-start text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  {tbl.columns.map((c) => (
                    <th key={c} className="py-2 pe-3 text-start font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tbl.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j} className={`py-2 pe-3 ${typeof c === "number" ? "tabular-nums" : ""}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {doc.narrative.map((h) => (
        <section key={h} className="mt-6">
          <h4 className="font-display text-lg">{h}</h4>
          <div className="mt-2 h-16 rounded-lg border border-dashed border-line" aria-hidden />
        </section>
      ))}
    </article>
  );
}
