"use client";

import Link from "next/link";

/**
 * The Ledger design (round 3, "ROP Workflow Home: three directions", artboard D): the template for
 * management and admin pages. Narrow type, figures and codes in mono, a double rule under the page
 * head, section heads with a gold tick, ruled numbered rows with a mono column head, figures to
 * the right, one gold-washed row to look at first, and square solid status blocks. No floating
 * cards: a page is a sheet of ruled rows. Notes for each piece: docs/DESIGN-LEDGER.md.
 */

const focus = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";

/** The double rule under a page head, as in a ledger book. */
export function DoubleRule({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={className}>
      <div className="h-1 bg-forest" />
      <div className="mt-[3px] h-px bg-forest" />
    </div>
  );
}

/**
 * A page's head: where it sits (a back link), what it is, a one-line purpose, the date or a count
 * at the right in mono, actions, and the double rule under it all.
 */
export function PageHead({
  back,
  kicker,
  title,
  meta,
  actions,
  children,
}: {
  back?: { href: string; label: string };
  kicker?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="font-ledger">
      {back && (
        <Link href={back.href} className="text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      {kicker && <p className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-warn">{kicker}</p>}
      <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="min-w-0 flex-1 text-4xl font-bold leading-none tracking-tight text-ink sm:text-5xl">{title}</h1>
        {meta && <p className="font-mono text-xs text-ink">{meta}</p>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-2 max-w-3xl text-sm text-muted">{children}</div>}
      <DoubleRule className="mt-4" />
    </header>
  );
}

/** A section's head: the gold tick, bold narrow type, and room at the right for a count or an action. */
export function SectionHead({ id, children, aside, className = "mt-8" }: { id?: string; children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-end gap-x-4 gap-y-2 ${className}`}>
      <h2 id={id} className="min-w-0 flex-1 border-s-[6px] border-ochre ps-2.5 font-ledger text-xl font-bold leading-tight text-ink">
        {children}
      </h2>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

/**
 * Ruled rows. `cols` is a CSS grid template used by the head and every row, so columns line up
 * (e.g. "2.5rem 1fr 8rem 8rem"). On a phone the head hides and each row wraps.
 */
export type HeadCell = React.ReactNode | { label: React.ReactNode; end?: boolean };
const isCell = (h: HeadCell): h is { label: React.ReactNode; end?: boolean } => !!h && typeof h === "object" && "label" in (h as object);
export function LedgerTable({ cols, head, children, label, className = "mt-3" }: { cols: string; head: HeadCell[]; children: React.ReactNode; label?: string; className?: string }) {
  return (
    <div className={`font-ledger ${className}`} role="table" aria-label={label}>
      <div role="row" className="hidden gap-x-3 border-y border-ink px-3 py-1.5 font-mono text-xs sm:grid" style={{ gridTemplateColumns: cols }}>
        {head.map((h, i) => {
          // A figure column's head sits right, over its figures: say so with { label, end: true }, or name it as an amount.
          const end = isCell(h) ? !!h.end : typeof h === "string" && /^(USD|AFN|Amount|Value|Hours|Days|Total|Gross|Net|Spent|Left|Budget|Count)\b/.test(h);
          return (
            <span key={i} role="columnheader" className={end ? "text-end" : ""}>
              {isCell(h) ? h.label : h}
            </span>
          );
        })}
      </div>
      <div role="rowgroup" className="border-t border-ink sm:border-t-0 [&>*:last-child]:border-ink">
        {children}
      </div>
    </div>
  );
}

/**
 * One ruled row. `n` numbers it (01, 02…); `first` gives it the gold wash (the one row to look at
 * first, one per table); `href` or `onClick` makes the whole row the target.
 */
export function LedgerRow({ cols, n, first, href, onClick, selected, children, className = "" }: { cols: string; n?: number; first?: boolean; href?: string; onClick?: () => void; selected?: boolean; children: React.ReactNode; className?: string }) {
  const cls = `grid min-h-12 items-start gap-x-3 gap-y-1 border-b px-3 py-2.5 text-start ${first ? "border-ink bg-ochre-soft" : "border-line"} ${selected ? "outline outline-2 -outline-offset-2 outline-forest" : ""} ${href || onClick ? `w-full hover:bg-ochre-soft ${focus}` : ""} ${className}`;
  const style = { gridTemplateColumns: n === undefined ? cols : `2.25rem ${cols}` };
  const num = n !== undefined && (
    <span aria-hidden className="pt-0.5 font-mono text-xs text-muted">
      {String(n).padStart(2, "0")}
    </span>
  );
  if (href)
    return (
      <Link role="row" href={href} className={cls} style={style}>
        {num}
        {children}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" role="row" onClick={onClick} className={cls} style={style}>
        {num}
        {children}
      </button>
    );
  return (
    <div role="row" className={cls} style={style}>
      {num}
      {children}
    </div>
  );
}

/** A figure: mono, lined up, to the right of its column. */
export function Fig({ children, strong, tone, className = "" }: { children: React.ReactNode; strong?: boolean; tone?: "clay" | "warn" | "muted" | "forest"; className?: string }) {
  const color = tone === "clay" ? "text-clay" : tone === "warn" ? "text-warn" : tone === "muted" ? "text-muted" : tone === "forest" ? "text-forest" : "";
  return <span className={`text-end font-mono text-sm tabular-nums ${strong ? "font-bold" : ""} ${color} ${className}`}>{children}</span>;
}

/** Key figures in a ruled strip: a small label over a mono figure. */
export function Figures({ items, className = "mt-4" }: { items: { label: string; value: React.ReactNode; tone?: "clay" | "warn" }[]; className?: string }) {
  return (
    <dl className={`flex flex-wrap gap-x-8 gap-y-2 border-y border-ink py-3 font-ledger ${className}`}>
      {items.map((x) => (
        <div key={x.label}>
          <dt className="font-mono text-xs text-muted">{x.label}</dt>
          <dd className={`font-mono text-xl font-bold tabular-nums ${x.tone === "clay" ? "text-clay" : x.tone === "warn" ? "text-warn" : "text-ink"}`}>{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A status as a square solid block: green done, gold waiting, red needs fixing, grey not active. */
export function StatusBlock({ tone, children }: { tone: "forest" | "ochre" | "clay" | "muted" | "sky"; children: React.ReactNode }) {
  const t = { forest: "bg-forest text-forest-ink", ochre: "bg-ochre text-ink", clay: "bg-clay-soft text-clay ring-1 ring-inset ring-clay", muted: "bg-sunken text-ink", sky: "bg-sky-soft text-ink" }[tone];
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 font-ledger text-sm font-bold ${t}`}>{children}</span>;
}

/** A plain ruled panel for a form or a detail: a rule above, no floating box. */
export function Sheet({ children, className = "mt-4", tone }: { children: React.ReactNode; className?: string; tone?: "gold" }) {
  return <div className={`border-t-2 border-ink pt-4 ${tone === "gold" ? "bg-ochre-soft px-4 pb-4" : ""} ${className}`}>{children}</div>;
}

/** Nothing here yet: one quiet line, ruled, never a big empty box. */
export function Empty({ children, className = "mt-3" }: { children: React.ReactNode; className?: string }) {
  return <p className={`border-y border-line px-3 py-4 text-sm text-muted ${className}`}>{children}</p>;
}
