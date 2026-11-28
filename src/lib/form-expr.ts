/**
 * The small rule language the app's field forms are written in (lib/distribution-form,
 * lib/field-forms): when a question is shown ("relevant"), when an answer is refused ("constraint")
 * and what a worked-out value is ("calculation"). It is the XLSForm subset those forms use, so the
 * same form reads the same way on the phone and on the server, which checks every answer again.
 *
 * Supported: numbers, 'text', `.` (this answer), ${name}, ( ), = != < <= > >=, and, or, + - * div,
 * and the functions today(), string-length(), number(), round(), if(), concat(), selected(),
 * count-selected() and pulldata(). Anything else is refused when the form is read, never guessed.
 *
 * Pure: an expression and the answers in, a value out.
 */

export type Value = string | number | boolean;

export type ExprContext = {
  /** The answer (or worked-out value) of another question, "" when it has none. */
  value: (name: string) => string;
  /** The answer being checked, for `.` in a constraint. */
  self?: string;
  /** Today, YYYY-MM-DD. */
  today: string;
  /** pulldata(file, column, keyColumn, key): a value from a list the form carries, "" when absent. */
  lookup?: (file: string, column: string, key: string) => string;
};

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "dot" } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "(" } | { t: ")" } | { t: "," };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "$" && src[i + 1] === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) throw new Error(`Unclosed \${ in: ${src}`);
      out.push({ t: "ref", v: src.slice(i + 2, end) });
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unclosed text in: ${src}`);
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === ".") { out.push({ t: "dot" }); i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === ",") { out.push({ t: "," }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "!=") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("=<>+-*".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    const w = /^[a-z][a-z-]*/.exec(src.slice(i));
    if (w) {
      out.push(["and", "or", "div"].includes(w[0]) ? { t: "op", v: w[0] } : { t: "id", v: w[0] });
      i += w[0].length;
      continue;
    }
    throw new Error(`The form rule cannot be read at "${src.slice(i)}"`);
  }
  return out;
}

type Node =
  | { k: "lit"; v: Value }
  | { k: "ref"; v: string }
  | { k: "dot" }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node }
  | { k: "call"; f: string; args: Node[] };

const FUNCS = new Set(["today", "string-length", "number", "round", "if", "concat", "selected", "count-selected", "pulldata", "not"]);

function parse(src: string): Node {
  const ts = tokens(src);
  let p = 0;
  const peek = () => ts[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const expect = (t: Tok["t"]) => {
    if (peek()?.t !== t) throw new Error(`The form rule "${src}" is not complete`);
    return ts[p++];
  };
  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    while (peek()?.t === "op" && ops.includes((peek() as { v: string }).v)) {
      const op = (ts[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  };
  const primary = (): Node => {
    const t = ts[p++];
    if (!t) throw new Error(`The form rule "${src}" is not complete`);
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "ref") return { k: "ref", v: t.v };
    if (t.t === "dot") return { k: "dot" };
    if (t.t === "(") {
      const e = or();
      expect(")");
      return e;
    }
    if (t.t === "op" && t.v === "-") return { k: "neg", a: primary() };
    if (t.t === "id") {
      if (!FUNCS.has(t.v)) throw new Error(`The form rule uses ${t.v}(), which the app does not know`);
      expect("(");
      const args: Node[] = [];
      if (peek()?.t !== ")") {
        args.push(or());
        while (peek()?.t === ",") { p++; args.push(or()); }
      }
      expect(")");
      return { k: "call", f: t.v, args };
    }
    throw new Error(`The form rule "${src}" cannot be read`);
  };
  const mul = binary(primary, ["*", "div"]);
  const add = binary(mul, ["+", "-"]);
  const cmp = (): Node => {
    const a = add();
    for (const op of ["=", "!=", "<", "<=", ">", ">="]) if (isOp(op)) { p++; return { k: "bin", op, a, b: add() }; }
    return a;
  };
  const and = binary(cmp, ["and"]);
  const or = binary(and, ["or"]);
  const tree = or();
  if (p < ts.length) throw new Error(`The form rule "${src}" has something extra at the end`);
  return tree;
}

const num = (v: Value) => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : v.trim() === "" ? NaN : Number(v));
const str = (v: Value) => (typeof v === "string" ? v : typeof v === "boolean" ? (v ? "true" : "false") : Number.isFinite(v) ? String(v) : "");
export const truthy = (v: Value) => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 && !Number.isNaN(v) : v !== "");

function compare(op: string, a: Value, b: Value): boolean {
  // A number on either side compares as numbers; otherwise as text (dates are YYYY-MM-DD, so text order is date order).
  const numeric = typeof a === "number" || typeof b === "number";
  if (numeric) {
    const x = num(a);
    const y = num(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return op === "!=";
    return op === "=" ? x === y : op === "!=" ? x !== y : op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
  }
  const x = str(a);
  const y = str(b);
  return op === "=" ? x === y : op === "!=" ? x !== y : op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

function run(n: Node, c: ExprContext): Value {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref":
      return c.value(n.v);
    case "dot":
      return c.self ?? "";
    case "neg":
      return -num(run(n.a, c));
    case "bin": {
      if (n.op === "and") return truthy(run(n.a, c)) && truthy(run(n.b, c));
      if (n.op === "or") return truthy(run(n.a, c)) || truthy(run(n.b, c));
      const a = run(n.a, c);
      const b = run(n.b, c);
      if (n.op === "+") return num(a) + num(b);
      if (n.op === "-") return num(a) - num(b);
      if (n.op === "*") return num(a) * num(b);
      if (n.op === "div") return num(a) / num(b);
      return compare(n.op, a, b);
    }
    case "call": {
      const a = n.args.map((x) => run(x, c));
      switch (n.f) {
        case "today":
          return c.today;
        case "string-length":
          return str(a[0] ?? "").length;
        case "number":
          return num(a[0] ?? "");
        case "not":
          return !truthy(a[0] ?? false);
        case "round": {
          const d = Math.max(0, Math.trunc(num(a[1] ?? 0)) || 0);
          const f = 10 ** d;
          return Math.round(num(a[0] ?? "") * f) / f;
        }
        case "if":
          return truthy(a[0] ?? false) ? (a[1] ?? "") : (a[2] ?? "");
        case "concat":
          return a.map(str).join("");
        case "selected":
          return str(a[0] ?? "").split(" ").includes(str(a[1] ?? ""));
        case "count-selected":
          return str(a[0] ?? "").split(" ").filter(Boolean).length;
        case "pulldata":
          return c.lookup?.(str(a[0]), str(a[1]), str(a[3] ?? "")) ?? "";
      }
    }
  }
  throw new Error("The form rule cannot be worked out");
}

const parsed = new Map<string, Node>();

/** Reads a rule once (kept), throwing a plain sentence when the app cannot read it. */
export function compile(src: string): Node {
  let n = parsed.get(src);
  if (!n) {
    n = parse(src);
    parsed.set(src, n);
  }
  return n;
}

/** Works out a rule against the answers. */
export const evaluate = (src: string, c: ExprContext): Value => run(compile(src), c);

/** A worked-out value as the text an answer would hold ("" for nothing; whole numbers without ".0"). */
export const asText = (v: Value) => (typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "") : str(v));
