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
  const [fromDraft, setFromDraft] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ setup: FieldSetup | null; draft: FieldSetup | null; lines: Line[]; canEdit: boolean }>(`/api/projects/${encodeURIComponent(code)}/field/setup`, user.id)
      .then((r) => {
        setLines(r.lines);
        setCanEdit(r.canEdit);
        const s = r.setup ?? r.draft;
        setFromDraft(!r.setup && !!r.draft);
        if (s) {
          setItems(s.items.map(toDraft));
          setSeason(s.season ?? "");
          setVillage(s.village ?? "");
          setCrop(s.crop ?? "");
          setWindowEnd(s.windowEnd ?? "");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, user]);

  const built: FieldSetup = {
    items: items.map((d) => ({ key: d.key || keyFrom(d.item), item: d.item.trim(), unit: d.unit.trim(), qty: Number(d.qty), per: d.per, budgetLine: d.budgetLine, ...(d.unitUsd.trim() ? { unitUsd: Number(d.unitUsd) } : {}) })),
    ...(season.trim() ? { season: season.trim() } : {}),
    ...(village.trim() ? { village: village.trim() } : {}),
    ...(crop.trim() ? { crop: crop.trim() } : {}),
    ...(windowEnd ? { windowEnd } : {}),
  };
  const problem = setupProblem(built);
  const set = (k: number, patch: Partial<Draft>) => setItems((all) => all.map((d, j) => (j === k ? { ...d, ...patch } : d)));

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ setup: FieldSetup }>(`/api/projects/${encodeURIComponent(code)}/field/setup`, user?.id, { method: "PUT", body: JSON.stringify(built) });
      setError("");
      onSaved(r.setup);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const editable = canEdit || canEditProject(user);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">Field activities · {code}</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">What does one farmer receive?</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          List each input in the package and the budget line it is bought on. The store&apos;s stock, the goods received check and the supplier payment all follow from the purchases on that line.
          {fromDraft && " This was filled in from the budget: check the amounts before saving."}
        </p>
      </div>
      {!editable && <p className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">Only the project manager and plan approvers can set up the package.</p>}
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
  const mayNames = canSeePII(user);

  async function upload() {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; updated: number }>(`/api/projects/${encodeURIComponent(code)}/farmers`, user?.id, { method: "POST", body: JSON.stringify({ rows: parsed.rows }) });
      setError("");
      onDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(FARMER_TEMPLATE)}`;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">Field activities · {code}</p>
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
            <span className="font-semibold">{parsed.rows.length}</span> farmers ready to load
            {parsed.rows.length > 0 && ` (${parsed.rows.filter((r) => r.gender === "Female").length} women, ${parsed.rows.filter((r) => r.gender === "Male").length} men)`}.
          </p>
          {parsed.hasNames && !mayNames && <p className="text-clay">The list has names, and your role cannot add them. Remove the Name column, or ask someone with access to participants&apos; names to load it.</p>}
          {parsed.problems.length > 0 && (
            <div>
              <p className="font-medium text-clay">{parsed.problems.length} rows left out:</p>
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
          {busy ? "Loading…" : `Load ${parsed?.rows.length ?? 0} farmers`}
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
