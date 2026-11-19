import type { StatusKind } from "@/lib/procurement";

const tagStyles: Record<StatusKind, string> = {
  CUR: "bg-sky-soft text-sky",
  D1: "bg-ochre-soft text-warn",
  "D1*": "bg-clay-soft/60 text-warn ring-1 ring-inset ring-ochre/40",
  TS: "bg-mist text-leaf",
  OPEN: "bg-clay-soft text-clay",
  PA: "bg-plum-soft text-plum",
};

export function StatusTag({ kind, children }: { kind: StatusKind; children?: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 align-[1px] font-mono text-xs font-medium leading-[1.6] ${tagStyles[kind]}`}
    >
      {children ?? kind}
    </span>
  );
}

/** What each source code means, in plain words (docs/ROP-PROCUREMENT-BLUEPRINT.md, Status tags). */
export const SOURCE_WORDS: Record<StatusKind, string> = {
  CUR: "How it is done today",
  D1: "Draft procurement policy",
  "D1*": "Draft procurement policy, still to be confirmed",
  TS: "The planned way of working",
  OPEN: "Not decided yet",
  PA: "Example for the prototype only",
};

/**
 * "D1 §4.15; TS" as "Draft procurement policy §4.15 · The planned way of working". Sources that are
 * already words ("Finance Manual", "Income Tax Law 2009 Art. 72") stay as they are.
 */
export function plainSources(tag: string): string {
  return tag
    .split(";")
    .map((raw) => {
      const p = raw.trim().match(PART);
      return p ? `${SOURCE_WORDS[p[1] as StatusKind]}${p[2]}`.trim() : raw.trim();
    })
    .filter(Boolean)
    .join(" · ");
}

// Each tag group like "[D1 §4.1; TS]" may hold several sources separated by ";".
const GROUP = /\[((?:CUR|D1\*?|TS|OPEN|PA)\b[^[\]]*)\]/g;
const PART = /^(CUR|D1\*?|TS|OPEN|PA)(.*)$/;

/** Renders text with inline "[D1 §4.1]" style source tags as chips. */
export function Tagged({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(GROUP)) {
    out.push(text.slice(last, m.index));
    m[1].split(";").forEach((raw, j) => {
      const p = raw.trim().match(PART);
      if (!p) return;
      out.push(" ");
      out.push(
        <StatusTag key={`${m.index}-${j}`} kind={p[1] as StatusKind}>
          {(p[1] + p[2]).trim()}
        </StatusTag>,
      );
    });
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
