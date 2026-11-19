"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { FARMER_TEMPLATE, parseFarmers, type FarmerRow } from "@/lib/farmer-import";
import { canEditProject, canSeePII } from "@/lib/demo";
import { describePackage, keyFrom, setupProblem, type FieldSetup, type PackageItem } from "@/lib/package";

/**
 * Setting a project up for Field activities: the input package (what one farmer receives, on which
 * budget line) and the farmer list. A project without a package has no field workflow yet.
 */

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";
type Line = { code: string; description: string; unit: string };

async function api<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

type Draft = Omit<PackageItem, "qty" | "unitUsd"> & { qty: string; unitUsd: string };
const toDraft = (p: PackageItem): Draft => ({ ...p, qty: String(p.qty), unitUsd: p.unitUsd === undefined ? "" : String(p.unitUsd) });
const blank = (): Draft => ({ key: "", item: "", unit: "", qty: "", per: "farmer", budgetLine: "", unitUsd: "" });

/** The input package form. `initial` is the saved setup, or a draft prepared for the manager to confirm. */
export function PackageSetup({ code, onSaved, onCancel }: { code: string; onSaved: (s: FieldSetup) => void; onCancel?: () => void }) {
  const { user } = useSession();
  const [lines, setLines] = useState<Line[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [items, setItems] = useState<Draft[]>([blank()]);
  const [season, setSeason] = useState("");
  const [village, setVillage] = useState("");
  const [crop, setCrop] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  // The target an approved distribution adds a farmer to, and the targets to choose from.
  const [target, setTarget] = useState("");
  // When a farmer counts toward it: at the approved distribution, or when planting is recorded.
  const [targetAt, setTargetAt] = useState<"distribution" | "planting">("distribution");
  const [targets, setTargets] = useState<{ code: string; name: string; unit: string }[]>([]);
  const [fromDraft, setFromDraft] = useState(false);
  // A draft copied from another project says which one (lib/project-template).
  const [copiedFrom, setCopiedFrom] = useState("");
  // Projects this one can be started from, offered only while it has no package at all.
  const [sources, setSources] = useState<{ code: string; name: string }[]>([]);
  const [source, setSource] = useState("");
  const [copyNotes, setCopyNotes] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ setup: FieldSetup | null; draft: (FieldSetup & { from?: string }) | null; lines: Line[]; targets?: { code: string; name: string; unit: string }[]; canEdit: boolean }>(`/api/projects/${encodeURIComponent(code)}/field/setup`, user.id)
      .then((r) => {
        setLines(r.lines);
        setCanEdit(r.canEdit);
        setTargets(r.targets ?? []);
        const s = r.setup ?? r.draft;
        setFromDraft(!r.setup && !!r.draft);
        setCopiedFrom(!r.setup ? (r.draft?.from ?? "") : "");
        if (!s)
          api<{ sources: { code: string; name: string }[]; canCopy: boolean }>(`/api/projects/${encodeURIComponent(code)}/template`, user.id)
            .then((t) => {
              setSources(t.canCopy ? t.sources : []);
              setSource(t.sources[0]?.code ?? "");
            })
            .catch(() => setSources([]));
        else setSources([]);
        if (s) {
          // A draft copied from another project keeps a budget line only when this project's budget has it too.
          const known = new Set(r.lines.map((l) => l.code));
          setItems(s.items.map(toDraft).map((d) => (!r.setup && !known.has(d.budgetLine) ? { ...d, budgetLine: "" } : d)));
          setSeason(s.season ?? "");
          setVillage(s.village ?? "");
          setCrop(s.crop ?? "");
          setWindowEnd(s.windowEnd ?? "");
          setTarget(s.target ?? "");
          setTargetAt(s.targetAt ?? "distribution");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, user, reload]);

  /** Starts this project from another project's setup: its package as a draft, its approver and its targets. */
  async function copyFrom() {
    if (!source) return;
    setBusy(true);
    try {
      const r = await api<{ notes: string[] }>(`/api/projects/${encodeURIComponent(code)}/template`, user?.id, { method: "POST", body: JSON.stringify({ from: source }) });
      setError("");
      setCopyNotes(r.notes);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const built: FieldSetup = {
    items: items.map((d) => ({ key: d.key || keyFrom(d.item), item: d.item.trim(), unit: d.unit.trim(), qty: Number(d.qty), per: d.per, budgetLine: d.budgetLine, ...(d.unitUsd.trim() ? { unitUsd: Number(d.unitUsd) } : {}) })),
    ...(season.trim() ? { season: season.trim() } : {}),
    ...(village.trim() ? { village: village.trim() } : {}),
    ...(crop.trim() ? { crop: crop.trim() } : {}),
    ...(windowEnd ? { windowEnd } : {}),
    ...(target ? { target } : {}),
    ...(target && targetAt === "planting" ? { targetAt } : {}),
  };
  const problem = setupProblem(built);
  const set = (k: number, patch: Partial<Draft>) => setItems((all) => all.map((d, j) => (j === k ? { ...d, ...patch } : d)));

  const [countedNow, setCountedNow] = useState<{ n: number; setup: FieldSetup; at: "distribution" | "planting" } | null>(null);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ setup: FieldSetup; counted?: number }>(`/api/projects/${encodeURIComponent(code)}/field/setup`, user?.id, { method: "PUT", body: JSON.stringify(built) });
      setError("");
      // Distributions approved before the target was named are counted now: say so before closing.
      if (r.counted) setCountedNow({ n: r.counted, setup: r.setup, at: r.setup.targetAt ?? "distribution" });
      else onSaved(r.setup);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (countedNow)
    return (
      <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
        <p className="font-semibold">Saved.</p>
        <p className="mt-1">
          {countedNow.at === "planting"
            ? `${countedNow.n} ${countedNow.n === 1 ? "farmer" : "farmers"} whose planting was already recorded ${countedNow.n === 1 ? "now counts" : "now count"} toward it`
            : `${countedNow.n} ${countedNow.n === 1 ? "distribution" : "distributions"} approved before the target was chosen ${countedNow.n === 1 ? "now counts" : "now count"} toward it`}
          , waiting for MEL on the Results page like any other result. A farmer already counted is never counted twice.
        </p>
        <button type="button" onClick={() => onSaved(countedNow.setup)} className="mt-3 font-semibold text-forest underline">
          Continue
        </button>
      </div>
    );

  const editable = canEdit || canEditProject(user);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">Field activities · {code}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">What does one farmer receive?</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          List each input in the package and the budget line it is bought on. The store&apos;s stock, the goods received check and the supplier payment all follow from the purchases on that line.
          {fromDraft && (copiedFrom ? ` This was copied from ${copiedFrom}: check each amount and its budget line before saving.` : " This was filled in from the budget: check the amounts before saving.")}
        </p>
      </div>
      {editable && sources.length > 0 && !fromDraft && (
        <section className="rounded-2xl border border-forest/40 bg-mist p-4" aria-labelledby="start-from">
          <h3 id="start-from" className="font-medium">
            Start from a project that is already running
          </h3>
          <p className="mt-1 text-sm text-muted">Copies its input package as a draft for you to check, who approves KoboCollect data, and its targets. Nothing about farmers, records or money is copied, and nothing already set on this project is changed.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Project to start from" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {sources.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            <button type="button" className={primaryBtn} disabled={busy || !source} onClick={copyFrom}>
              Copy its setup
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Or fill in the package below from nothing.</p>
        </section>
      )}
      {copyNotes.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 text-sm" aria-live="polite">
          <p className="font-medium">Copied. What to do next:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {copyNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </section>
      )}
      {!editable && <p className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">Only the project manager and plan approvers can set up the package.</p>}
      {editable && !lines.length && (
        <p className="rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm">
          This project has no budget yet, so there is no budget line to choose. <a href="/setup" className="font-medium underline">Add the budget in Setup</a> first, then come back and choose the line each item is bought on.
        </p>
      )}
      <div className="space-y-4">
        {items.map((d, k) => (
          <fieldset key={k} disabled={!editable} className="rounded-2xl border border-line bg-surface p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Item {k + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">
                Name
                <input value={d.item} onChange={(e) => set(k, { item: e.target.value, key: d.key && d.key !== keyFrom(d.item) ? d.key : keyFrom(e.target.value) })} placeholder="e.g. Grape planting cuttings" className={`mt-1 ${field}`} />
              </label>
              <label className="block text-sm font-medium">
                Amount
                <input type="number" min={0} step="any" inputMode="decimal" value={d.qty} onChange={(e) => set(k, { qty: e.target.value })} className={`mt-1 ${field}`} />
              </label>
              <label className="block text-sm font-medium">
                Unit
                <input value={d.unit} onChange={(e) => set(k, { unit: e.target.value })} placeholder="kg, cuttings, hectare..." className={`mt-1 ${field}`} />
              </label>
              <label className="block text-sm font-medium">
                For each
                <select value={d.per} onChange={(e) => set(k, { per: e.target.value as Draft["per"] })} className={`mt-1 ${field}`}>
                  <option value="farmer">farmer</option>
                  <option value="hectare">hectare of the farmer&apos;s plot</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Cost per unit (USD, optional)
                <input type="number" min={0} step="any" inputMode="decimal" value={d.unitUsd} onChange={(e) => set(k, { unitUsd: e.target.value })} className={`mt-1 ${field}`} />
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                Bought on budget line
                <select value={d.budgetLine} onChange={(e) => set(k, { budgetLine: e.target.value, unit: d.unit || lines.find((l) => l.code === e.target.value)?.unit || "" })} className={`mt-1 ${field}`}>
                  <option value="">Choose a line</option>
                  {lines.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code} · {l.description.slice(0, 90)}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-muted">Use the same unit as the purchase on this line, or a weight (kg, t) when the purchase is weighed.</span>
              </label>
            </div>
            {items.length > 1 && (
              <button type="button" onClick={() => setItems((all) => all.filter((_, j) => j !== k))} className="mt-3 text-sm text-muted hover:text-clay">
                Remove this item
              </button>
            )}
          </fieldset>
        ))}
        {editable && (
          <button type="button" onClick={() => setItems((all) => [...all, blank()])} className={quietBtn}>
            + Add an item
          </button>
        )}
      </div>
      <fieldset disabled={!editable} className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Season (optional)</legend>
        <label className="block text-sm font-medium">
          Season name
          <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. 2027 spring planting" className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm font-medium">
          Distribution point
          <input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Where the store is" className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm font-medium">
          Crop
          <input value={crop} onChange={(e) => setCrop(e.target.value)} placeholder="e.g. Grapes" className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm font-medium">
          Planting window ends
          <input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className={`mt-1 ${field}`} />
        </label>
      </fieldset>
      <fieldset disabled={!editable} className="rounded-2xl border border-line bg-surface p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Count it toward a target (optional)</legend>
        <label className="block text-sm font-medium">
          Target this package counts toward
          <span className="mt-0.5 block text-xs font-normal text-muted">Each farmer adds one, from KoboCollect or recorded in the app. This is the only place they are counted, so nobody records them again on the Results page.</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`mt-1 ${field}`}>
            <option value="">Do not count distributions toward a target</option>
            {/* A saved target no longer on the list stays visible, so saving again does not drop it without anyone noticing. */}
            {target && !targets.some((x) => x.code === target) && <option value={target}>{target} (no longer takes recorded results)</option>}
            {targets.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name} ({x.unit})
              </option>
            ))}
          </select>
        </label>
        {target && (
          <div className="mt-3 text-sm" role="radiogroup" aria-label="When a farmer counts">
            <p className="font-medium">A farmer counts when</p>
            {(
              [
                ["distribution", "Their package is handed out and the project manager approves it", "For targets such as farmers who received inputs."],
                ["planting", "Their planting is recorded", "For targets met in the field: trellis systems installed, trees planted, hectares planted. A target counted in trees, vines or hectares adds what was planted; any other adds one farmer."],
              ] as const
            ).map(([v, label, help]) => (
              <label key={v} className="mt-2 flex items-start gap-2">
                <input type="radio" name="target-at" checked={targetAt === v} onChange={() => setTargetAt(v)} className="mt-1" />
                <span>
                  {label}
                  <span className="block text-xs text-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-sm text-muted">
          {target
            ? targetAt === "planting"
              ? "Each farmer whose planting the extension agent records adds one to this target, counted once MEL accepts it. The distribution alone does not count."
              : "Each distribution the project manager approves adds one farmer to this target. It counts once MEL accepts it, so nobody records the same distribution a second time."
            : targets.length
              ? "Choose a target and each approved distribution adds one farmer to it. Left empty, distributions have to be recorded again on the Results page to count."
              : "This project has no targets that take recorded results yet. Add them in the project design, then choose one here."}
        </p>
      </fieldset>
      {editable && (
        <div className="space-y-2">
          {problem ? <p className="text-sm text-muted">{problem}</p> : <p className="text-sm text-muted">Each farmer receives: {describePackage(built)}.</p>}
          {error && (
            <p role="alert" className="text-sm text-clay">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!!problem || busy} onClick={() => void save()} className={primaryBtn}>
              {busy ? "Saving…" : "Save the package"}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Loading the farmer list from a CSV saved from Excel. Problems are shown before anything is saved. */
export function FarmerImport({ code, onDone, onCancel }: { code: string; onDone: (r: { added: number; updated: number }) => void; onCancel?: () => void }) {
  const { user } = useSession();
  const [parsed, setParsed] = useState<{ rows: FarmerRow[]; problems: string[]; hasNames: boolean } | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ added: number; updated: number } | null>(null);
  const mayNames = canSeePII(user);
  const farmersN = (n: number) => `${n} ${n === 1 ? "farmer" : "farmers"}`;

  async function upload() {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; updated: number }>(`/api/projects/${encodeURIComponent(code)}/farmers`, user?.id, { method: "POST", body: JSON.stringify({ rows: parsed.rows }) });
      setError("");
      // Say what happened before the panel closes, so loading the list is not a silent click.
      setLoaded(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(FARMER_TEMPLATE)}`;
  if (loaded)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">Field activities · {code}</p>
        <p role="status" className="rounded-2xl border border-forest/30 bg-mist p-4 text-sm text-leaf">
          Farmer list loaded: {farmersN(loaded.added)} added{loaded.updated ? `, ${farmersN(loaded.updated)} updated` : ""}. New farmers start at the step given in the list (Train when none is given) and show in the list on the left.
        </p>
        <button type="button" onClick={() => onDone(loaded)} className={primaryBtn}>
          Done
        </button>
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">Field activities · {code}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">Load the farmer list</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One row per farmer: Farmer ID, Village, Sex (F or M) and Hectares. Name, Age band, Household size, Contribution paid and Step are optional. Save the sheet from Excel as CSV.
          Names are kept separately and shown only to people allowed to see them; phones, Kobo and emails use the farmer ID.
        </p>
        <a href={template} download="farmer-list-template.csv" className="mt-2 inline-block text-sm font-semibold text-forest hover:underline">
          Download the template
        </a>
      </div>
      <label className="block rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm">
        <span className="font-medium">{fileName || "Choose the CSV file"}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setParsed(parseFarmers(await f.text()));
            setError("");
          }}
        />
      </label>
      {parsed && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-sm">
          <p>
            <span className="font-semibold">{parsed.rows.length}</span> {parsed.rows.length === 1 ? "farmer" : "farmers"} ready to load
            {parsed.rows.length > 0 && ` (${parsed.rows.filter((r) => r.gender === "Female").length} women, ${parsed.rows.filter((r) => r.gender === "Male").length} men)`}.
          </p>
          {parsed.hasNames && !mayNames && <p className="text-clay">The list has names, and your role cannot add them. Remove the Name column, or ask someone with access to participants&apos; names to load it.</p>}
          {parsed.problems.length > 0 && (
            <div>
              <p className="font-medium text-clay">{parsed.problems.length === 1 ? "1 row" : `${parsed.problems.length} rows`} left out:</p>
              <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-muted">
                {parsed.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-clay">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!parsed?.rows.length || busy || (parsed.hasNames && !mayNames)} onClick={() => void upload()} className={primaryBtn}>
          {busy ? "Loading…" : `Load ${farmersN(parsed?.rows.length ?? 0)}`}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
