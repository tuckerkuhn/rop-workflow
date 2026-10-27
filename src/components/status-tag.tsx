import type { StatusKind } from "@/lib/procurement";

const tagStyles: Record<StatusKind, string> = {
  CUR: "bg-sky-soft text-sky",
  D1: "bg-ochre-soft text-ochre",
  "D1*": "bg-clay-soft/60 text-ochre ring-1 ring-inset ring-ochre/40",
  TS: "bg-mist text-leaf",
  OPEN: "bg-clay-soft text-clay",
  PA: "bg-plum-soft text-plum",
};

export function StatusTag({ kind, children }: { kind: StatusKind; children?: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 align-[1px] font-mono text-[10.5px] font-medium leading-[1.6] ${tagStyles[kind]}`}
    >
      {children ?? kind}
    </span>
  );
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
