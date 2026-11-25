"use client";

import { Why } from "@/components/app/why";
import { userById } from "@/lib/demo";
import { plainError } from "@/lib/plain-error";
import { askConfirm } from "@/components/app/dialogs";
import { FieldHelp } from "@/components/app/field-help";
import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { OriginalText } from "@/components/progress/original-text";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, LedgerRow, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import type { Receipt } from "@/lib/expense";
import type { PhotoPlaces, ResultAction, UpdateInput } from "@/lib/results";
import { mapEmbed, photoFacts } from "@/lib/exif";
import { longDate, periodLabel, weekOf, type WeeklyPatch } from "@/lib/weekly";
import { addToOutbox, isOffline, localHash } from "@/lib/outbox";
// The Word builder (and the `docx` library) loads on the Download click, not with the page.
import type { WeeklyImages } from "@/lib/weekly-docx";
import { captionWithDate } from "@/lib/weekly-caption";
import type { WeeklyView } from "@/server/weekly-store";
import { NamesWarning } from "@/components/progress/names-warning";

/**
 * The weekly update: what happened this week, item by item, with dated photos, written in the
 * app and downloaded as the Word document the team sends the donor. Each item is an activity
 * update, so the quarterly report draws on the same text and photos.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block min-h-12 w-full border border-line bg-paper px-3 py-2.5 text-base";
/** Buttons on a phone: at least 48px to tap. */
const primary = `${primaryBtn} min-h-12`;
const quiet = `${quietBtn} min-h-12`;
const textBtn = "inline-flex min-h-12 items-center text-sm";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
type Item = WeeklyView["items"][number];

/** A photo from the app's file store, shown small. */
function Thumb({ hash, user, alt, blob }: { hash: string; user: string; alt: string; blob?: Blob }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    let live = true;
    if (blob) {
      setSrc((url = URL.createObjectURL(blob)));
      return () => URL.revokeObjectURL(url);
    }
    fetch(`/api/files/${hash}`, { headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && live) setSrc((url = URL.createObjectURL(b)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hash, user, blob]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-28 w-40 object-cover" />
  ) : (
    <div className="h-28 w-40 bg-sunken" />
  );
}

/** Adds or changes one item: activity, title, date, what happened, and photos with caption and date taken. */
type Local = Record<string, { blob: Blob; name: string; type: string }>;
function ItemForm({ v, start, onSave, onQueue, onClose, className = "mt-3" }: { v: WeeklyView; start?: Item; className?: string; onSave: (u: UpdateInput) => Promise<void>; onQueue?: (u: UpdateInput, local: Local) => Promise<void>; onClose: () => void }) {
  const { user } = useSession();
  const { tx } = useT();
  const lastDay = v.week.to < v.today ? v.week.to : v.today;
  const [f, setF] = useState({ activity: start?.activity ?? v.activities[0]?.code ?? "", title: start?.title ?? "", date: start?.date ?? lastDay, note: start?.note ?? "" });
  const [files, setFiles] = useState<Receipt[]>(start?.files ?? []);
  const [captions, setCaptions] = useState<Record<string, string>>(start?.captions ?? {});
  const [taken, setTaken] = useState<Record<string, string>>(start?.taken ?? {});
  // Where each photo added now was taken, read from the photo. The places of photos already on the
  // item stay on the server: this screen is not given them to send back.
  const [places, setPlaces] = useState<PhotoPlaces>({});
  // Photos added on this screen now. A photo whose own place was removed (many phones and apps do)
  // can take the place of the device in hand, with one button, as on the farmer's page.
  const [added, setAdded] = useState<string[]>([]);
  const [fromDevice, setFromDevice] = useState<string[]>([]);
  const [locating, setLocating] = useState<string | null>(null);
  const placeFromDevice = (hash: string) => {
    if (!navigator.geolocation) return setErr(tx("This device cannot give its location. The photo can be saved without a place."));
    setLocating(hash);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(null);
        setPlaces((cur) => ({ ...cur, [hash]: { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lon: Math.round(pos.coords.longitude * 1e6) / 1e6 } }));
        setFromDevice((cur) => [...cur, hash]);
      },
      () => {
        setLocating(null);
        setErr(tx("The device did not give its location. The photo can be saved without a place."));
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  // Photos picked without a connection: kept on the phone until the item is sent.
  const [local, setLocal] = useState<Local>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const upload = async (list: FileList | null) => {
    if (!list) return;
    setErr("");
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        // The date and the place are in the original file; shrinking it for upload drops them.
        const facts = file.type === "image/jpeg" ? photoFacts(await file.arrayBuffer()) : null;
        const when = facts?.date ?? null;
        const at = facts?.gps ? { lat: Math.round(facts.gps.lat * 1e6) / 1e6, lon: Math.round(facts.gps.lon * 1e6) / 1e6 } : null;
        const small = await shrink(file);
        const body = new FormData();
        body.append("file", small);
        let r: Receipt;
        try {
          const res = await fetch("/api/files", { method: "POST", body, headers: { "x-demo-user": user?.id ?? "" } });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((out as { error?: string }).error ?? `Upload failed (${res.status})`);
          r = out as Receipt;
        } catch (e) {
          if (!onQueue || !isOffline(e)) throw e;
          r = { hash: localHash(), name: file.name, type: small.type || file.type, size: small.size };
          setLocal((cur) => ({ ...cur, [r.hash]: { blob: small, name: file.name, type: small.type || file.type } }));
        }
        setFiles((cur) => [...cur.filter((x) => x.hash !== r.hash), r].slice(0, 20));
        if (when) setTaken((cur) => ({ ...cur, [r.hash]: when }));
        if (at) setPlaces((cur) => ({ ...cur, [r.hash]: at }));
        if (small.type.startsWith("image/") || file.type.startsWith("image/")) setAdded((cur) => [...cur.filter((h) => h !== r.hash), r.hash]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setErr("");
    if (f.note.trim().length < 10) return setErr("Say what happened: where, with whom, what changed.");
    if (f.date < v.week.from || f.date > v.week.to) return setErr(`Date it within this week: ${periodLabel(v.week.from, v.week.to)}.`);
    const photos = files.filter((x) => x.type.startsWith("image/"));
    if (photos.some((x) => !captions[x.hash]?.trim())) return setErr("Give every photo a caption: what it shows, and the district. No names and no village: a donor may read it.");
    if (photos.some((x) => !taken[x.hash])) return setErr("Give every photo the date it was taken.");
    const keep = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([h, t]) => files.some((x) => x.hash === h) && t.trim()));
    const where: PhotoPlaces = Object.fromEntries(Object.entries(places).filter(([h]) => files.some((x) => x.hash === h)));
    const item: UpdateInput = { activity: f.activity, date: f.date, ...(f.title.trim() ? { title: f.title.trim() } : {}), note: f.note.trim(), files, captions: keep(captions), taken: keep(taken), ...(Object.keys(where).length ? { places: where } : {}) };
    const mine: Local = Object.fromEntries(Object.entries(local).filter(([h]) => files.some((x) => x.hash === h)));
    setBusy(true);
    try {
      // Without a connection, or with photos still on the phone: into the outbox, sent later.
      if (onQueue && (!navigator.onLine || Object.keys(mine).length)) await onQueue(item, mine);
      else
        await onSave(item).catch(async (e) => {
          if (onQueue && isOffline(e)) await onQueue(item, mine);
          else throw e;
        });
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className={className}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium sm:col-span-2">
          Activity
          <select className={input} value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })}>
            {v.activities.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code}: {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Date
          <input type="date" className={`${input} font-mono`} value={f.date} min={v.week.from} max={lastDay} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-medium">
        Heading (optional)
        <input className={input} value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Trellis installation" />
      </label>
      <label className="mt-3 block text-sm font-medium">
        What happened
        <FieldHelp field="weekly.note" />
        <textarea
          className={input}
          rows={4}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="Trellis systems were installed across 6 jeribs of vineyards: 2 in Musa Qala (Helmand), 1 in Maiwand and 3 in Nesh (Kandahar)."
        />
        <NamesWarning text={f.note} />
      </label>
      <div className="mt-3 text-sm">
        <span className="font-medium">Photos</span>
        <FieldHelp field="weekly.photos" />
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="mt-1 block w-full text-sm file:me-3 file:min-h-12 file:cursor-pointer file:border file:border-line-strong file:bg-paper file:px-4 file:font-semibold"
          onChange={(e) => void upload(e.target.files)}
        />
        {files.length > 0 && (
          <ul className="mt-3 border-t border-ink [&>li:last-child]:border-ink">
            {files.map((x) => (
              <li key={x.hash} className="border-b border-line py-3 text-sm">
                {/* On a phone: the photo and its remove button on one line, caption and date under it. */}
                <div className="flex flex-wrap items-start gap-3">
                  {user && <Thumb hash={x.hash} user={user.id} alt={captions[x.hash] ?? x.name} blob={local[x.hash]?.blob} />}
                  <button type="button" aria-label={`Remove ${x.name}`} className="ms-auto inline-flex min-h-12 min-w-12 items-center justify-center text-xl text-muted hover:text-clay sm:order-last" onClick={() => setFiles(files.filter((y) => y.hash !== x.hash))}>
                    ×
                  </button>
                  <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
                    <input className={input} placeholder="Caption: what it shows, and the district" value={captions[x.hash] ?? ""} onChange={(e) => setCaptions({ ...captions, [x.hash]: e.target.value })} aria-label="Caption" />
                    <label className="block font-medium">
                      Taken on
                      <input type="date" className={`${input} font-mono`} value={taken[x.hash] ?? ""} max={v.today} onChange={(e) => setTaken({ ...taken, [x.hash]: e.target.value })} />
                    </label>
                    {places[x.hash] && <p className="text-xs text-muted">✓ {fromDevice.includes(x.hash) ? tx("Place taken from this device.") : tx("Place found in the photo.")} {tx("It is shown only to people who may see participant names and to the person named to approve KoboCollect data or their stand-in.")}</p>}
                    {!places[x.hash] && added.includes(x.hash) && (
                      <div className="text-xs text-muted">
                        <p>{tx("No place in this photo. Many phones and apps remove it.")}</p>
                        <button type="button" className={`${quietBtn} mt-1 min-h-11`} disabled={locating !== null} onClick={() => placeFromDevice(x.hash)}>
                          {locating === x.hash ? tx("Finding this device…") : tx("Use this device’s location")}
                        </button>
                        <span className="ms-2">{tx("Only if you are where the photo was taken.")}</span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {err}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={primary} onClick={() => void submit()}>
          {start ? "Save" : "Add to this week"}
        </button>
        <button type="button" className={quiet} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** One item of the week: a numbered ruled row, the photos under the text, the date and author in mono beneath. */
function ItemCard({ it, n, v, user, act }: { it: Item; n: number; v: WeeklyView; user: string; act: (a: ResultAction, msg: string) => Promise<void> }) {
  const { tx } = useT();
  const [editing, setEditing] = useState(false);
  // The photo whose place is open on the map. The map is loaded only when asked for: showing it
  // sends the point to OpenStreetMap, and a point can be where a farmer lives.
  const [mapOf, setMapOf] = useState("");
  const activity = v.activities.find((a) => a.code === it.activity);
  const photos = it.files.filter((f) => f.type.startsWith("image/"));
  if (editing)
    return (
      <LedgerRow n={n} cols="minmax(0,1fr)">
        <ItemForm v={v} start={it} className="mt-0" onClose={() => setEditing(false)} onSave={(u) => act({ action: "update-edit", id: it.id, update: u }, "Saved.").then(() => setEditing(false))} />
      </LedgerRow>
    );
  return (
    <LedgerRow n={n} cols="minmax(0,1fr)" className="text-sm">
      <div className="min-w-0">
        <p className="text-xs text-muted">
          <span className="font-mono text-ink">{it.activity}</span>
          {activity ? `: ${activity.name}` : ""}
        </p>
        <p className="mt-1 text-sm">
          {it.title && <span className="font-bold">{it.title}: </span>}
          {it.note}
        </p>
        <OriginalText original={it.original} />
        {photos.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-3">
            {photos.map((f) => (
              <li key={f.hash} className="w-40 text-xs">
                <button type="button" onClick={() => void openReceipt(f.hash, user)} className="block">
                  <Thumb hash={f.hash} user={user} alt={it.captions?.[f.hash] ?? f.name} />
                </button>
                <span className="mt-1 block text-muted">{captionWithDate(it.captions?.[f.hash] ?? "", it.taken?.[f.hash])}</span>
                {it.places[f.hash] && (
                  <button type="button" aria-expanded={mapOf === f.hash} className={`${textBtn} font-semibold text-forest hover:underline`} onClick={() => setMapOf(mapOf === f.hash ? "" : f.hash)}>
                    {mapOf === f.hash ? tx("Hide the map") : tx("Show on a map")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {photos.some((f) => it.places[f.hash]) && !mapOf && <p className="text-xs text-muted">{tx("The place was read from the photo or given by the device. It is shown only to people who may see participant names and to the person named to approve KoboCollect data or their stand-in.")} {tx("The map comes from OpenStreetMap. Opening it sends this point to their map service.")}</p>}
        {mapOf && it.places[mapOf] && (
          <div className="mt-2">
            <p className="text-xs text-muted">
              {tx("Where this photo was taken:")} <span className="font-mono">{it.places[mapOf].lat.toFixed(5)}, {it.places[mapOf].lon.toFixed(5)}</span>
              {it.captions?.[mapOf] ? ` · ${it.captions[mapOf]}` : ""}
            </p>
            <iframe title={tx("Map of where the photo was taken")} src={mapEmbed(it.places[mapOf])} className="mt-2 h-56 w-full border border-line" loading="lazy" referrerPolicy="no-referrer" />
          </div>
        )}
        <p className="mt-2 font-mono text-xs text-muted tabular-nums">
          {it.date} · {userById(it.by)?.name ?? it.by}
        </p>
        {it.mayEdit && (
          <div className="mt-1 flex gap-5">
            <button type="button" className={`${textBtn} font-semibold text-forest hover:underline`} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className={`${textBtn} text-muted hover:text-clay`} onClick={() => void askConfirm({ message: "Remove this item from the week?", confirm: "Remove", danger: true }).then((ok) => (ok ? act({ action: "update-remove", id: it.id }, "Removed.").catch(() => undefined) : undefined))}>
              Remove
            </button>
          </div>
        )}
      </div>
    </LedgerRow>
  );
}

/** The week's number and dates: set before the first item, changeable until it is sent. */
function WeekBox({ v, save }: { v: WeeklyView; save: (a: WeeklyPatch, msg: string) => Promise<void> }) {
  const [f, setF] = useState({ n: String(v.week.n), from: v.week.from, to: v.week.to });
  const [open, setOpen] = useState(!v.week.saved);
  useEffect(() => {
    setF({ n: String(v.week.n), from: v.week.from, to: v.week.to });
    setOpen(!v.week.saved);
  }, [v.week.n, v.week.from, v.week.to, v.week.saved]);
  if (!v.may.write || (!open && v.week.saved))
    return v.may.write ? (
      <button type="button" className={`${textBtn} mt-1 text-muted hover:text-ink`} onClick={() => setOpen(true)}>
        Change the number or dates
      </button>
    ) : null;
  return (
    <Sheet className="mt-3">
      <p className="text-sm">{v.week.saved ? "Change this update's number or dates." : "Start this week's update. The week runs Sunday to Thursday; change the dates if this one is different."}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Number
          <input inputMode="numeric" className={`${input} font-mono`} value={f.n} onChange={(e) => setF({ ...f, n: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="text-sm font-medium">
          From
          <input type="date" className={`${input} font-mono`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="text-sm font-medium">
          To
          <input type="date" className={`${input} font-mono`} value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={!f.n || !f.from || !f.to}
          onClick={() => void save({ action: "week", n: Number(f.n), from: f.from, to: f.to, ...(v.week.saved ? { was: v.week.from } : {}) }, v.week.saved ? "Saved." : `Update #${f.n} started.`).catch(() => undefined)}
        >
          {v.week.saved ? "Save" : `Start update #${f.n || "?"}`}
        </button>
        {v.week.saved && (
          <button type="button" className={quiet} onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </Sheet>
  );
}

function Region({ v, save }: { v: WeeklyView; save: (a: WeeklyPatch, msg: string) => Promise<void> }) {
  const [r, setR] = useState(v.region);
  useEffect(() => setR(v.region), [v.region]);
  if (!v.may.write) return null;
  return (
    <label className="mt-3 block text-sm font-medium">
      The line under &ldquo;Roots of Peace:&rdquo; (same every week)
      <div className="flex items-start gap-2">
        <input className={input} value={r} onChange={(e) => setR(e.target.value)} placeholder="Southern region (Kandahar and Helmand)" />
        {r !== v.region && (
          <button type="button" className={`${quiet} mt-1 shrink-0`} onClick={() => void save({ action: "region", region: r }, "Saved.").catch(() => undefined)}>
            Save
          </button>
        )}
      </div>
    </label>
  );
}

export function WeeklyPage() {
  const { t } = useT();
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const params = useSearchParams();
  const router = useRouter();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from") : null;
  const [v, setV] = useState<WeeklyView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${project.id}/weekly${from ? `?from=${from}` : ""}`;

  // Offline, the form opens from the week's dates and activity names kept from the last visit:
  // never anyone's items, which stay on the server.
  const shellKey = `rop-weekly-shell:${project.id}`;
  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const got = await call<WeeklyView>(url, user.id);
      setV(got);
      setError("");
      setOffline(false);
      try {
        if (got.week.saved && !got.week.sent) localStorage.setItem(shellKey, JSON.stringify({ ...got, items: [], weeks: [], region: "" }));
      } catch {}
    } catch (e) {
      if (isOffline(e)) {
        try {
          const shell = JSON.parse(localStorage.getItem(shellKey) ?? "null") as WeeklyView | null;
          if (shell) {
            setV({ ...shell, today: new Date().toISOString().slice(0, 10) });
            setOffline(true);
            return;
          }
        } catch {}
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url, shellKey]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  // From "+ New → Weekly update item".
  useEffect(() => {
    if (params.get("new") === "1") setAdding(true);
  }, [params]);

  if (!user) return null;
  const go = (f: string) => router.push(`/progress/weekly?from=${f}`);
  const save = async (a: WeeklyPatch, msg: string) => {
    setError("");
    setNotice("");
    try {
      const out = await call<WeeklyView>(`/api/projects/${project.id}/weekly`, user.id, { method: "POST", body: JSON.stringify(a) });
      setV(out);
      setNotice(msg);
      if (out.week.from !== from) router.replace(`/progress/weekly?from=${out.week.from}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const act = async (a: ResultAction, msg: string) => {
    setError("");
    setNotice("");
    try {
      await call(`/api/projects/${project.id}/results`, user.id, { method: "POST", body: JSON.stringify(a) });
      await load();
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const download = async () => {
    if (!v) return;
    setBusy(true);
    setError("");
    try {
      const items = v.items.map((i) => ({ title: i.title, note: i.note, photos: i.files.filter((f) => f.type.startsWith("image/")).map((f) => ({ hash: f.hash, caption: i.captions?.[f.hash] ?? "", taken: i.taken?.[f.hash] })) }));
      const images: WeeklyImages = new Map();
      for (const ph of items.flatMap((i) => i.photos)) {
        try {
          const res = await fetch(`/api/files/${ph.hash}`, { headers: { "x-demo-user": user.id } });
          if (!res.ok) continue;
          const bmp = await createImageBitmap(await res.blob());
          const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(bmp.width * scale);
          canvas.height = Math.round(bmp.height * scale);
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
          if (blob) images.set(ph.hash, { data: await blob.arrayBuffer(), width: canvas.width, height: canvas.height });
        } catch {
          /* marked in the document */
        }
      }
      const { weeklyDocx } = await import("@/lib/weekly-docx");
      const blob = await weeklyDocx({ project: v.project, region: v.region, week: v.week, items }, images);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${v.week.n}- RoP-weekly update ${periodLabel(v.week.from, v.week.to)}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError(`The Word file could not be made: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const w = v?.week;
  const photoCount = v?.items.reduce((s, i) => s + i.files.filter((f) => f.type.startsWith("image/")).length, 0) ?? 0;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHead
          back={{ href: "/progress", label: "Progress" }}
          kicker={project.name}
          title={`Weekly update${w?.saved ? ` #${w.n}` : ""}`}
          actions={w && <StatusBlock tone={w.sent ? "forest" : w.saved ? "ochre" : "muted"}>{w.sent ? "Sent" : w.saved ? "Open" : "Not started"}</StatusBlock>}
        >
          What happened this week, activity by activity, with dated photos. Download it for Word and send it as now; the quarterly report uses the same items and photos.
        </PageHead>
        <Why>A week written down the week it happened is evidence. The same week remembered three months later, when the report is due, is a guess.</Why>
        {!project.saved && <Empty className="mt-6">Choose a project first.</Empty>}
        {offline && <p className="mt-4 bg-ochre-soft px-4 py-3 text-sm">No connection. You can add items to this week; they wait on this phone and are sent when the connection is back. The week&rsquo;s other items show once you are online.</p>}
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && <p className="mt-4 bg-mist px-4 py-3 text-sm text-forest">{notice}</p>}
        {!v && !error && project.saved && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && w && (
          <>
            {/* The week switcher: the week's name, its dates in mono, earlier weeks by number. */}
            <section className="mt-6 font-ledger">
              <div className="flex items-center gap-2 border-b border-ink pb-3">
                <button type="button" className={`${quiet} min-w-12`} onClick={() => go(weekOf(addDays(w.from, -2)).from)} aria-label="Previous week">
                  ←
                </button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="text-lg font-bold leading-tight">{periodLabel(w.from, w.to)}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">
                    {w.from} – {w.to}
                  </p>
                </div>
                <button type="button" className={`${quiet} min-w-12`} onClick={() => go(weekOf(addDays(w.to, 3)).from)} aria-label="Next week" disabled={addDays(w.to, 1) > v.today}>
                  →
                </button>
              </div>
              {v.weeks.length > 0 && (
                <p className="mt-1 flex flex-wrap justify-center gap-x-1 font-mono text-xs text-muted">
                  {v.weeks.slice(0, 8).map((x) => (
                    <Link
                      key={x.from}
                      href={`/progress/weekly?from=${x.from}`}
                      aria-current={x.from === w.from ? "page" : undefined}
                      className={`inline-flex min-h-12 min-w-12 items-center justify-center px-2 hover:text-ink ${x.from === w.from ? "border-b-2 border-ink font-bold text-ink" : ""}`}
                    >
                      #{x.n}
                      {x.sent ? " ✓" : ""}
                    </Link>
                  ))}
                </p>
              )}
              <WeekBox v={v} save={save} />
              {w.sent && (
                <p className="mt-3 bg-mist px-4 py-3 text-sm text-forest">
                  Sent by {userById(w.sent.by)?.name ?? w.sent.by} on {longDate(w.sent.at.slice(0, 10))}. It can no longer be changed.
                </p>
              )}
            </section>

            {(w.saved || v.items.length > 0 || !v.may.write) && (
              <section>
                <SectionHead>This week</SectionHead>
                {w.saved && <Region v={v} save={save} />}
                {v.items.length === 0 && !adding && <Empty>{w.saved ? "Nothing added yet." : "No weekly update for this week. Field staff and MEL write it."}</Empty>}
                {v.items.length > 0 && (
                  <div role="table" aria-label="This week" className="mt-3 border-t border-ink font-ledger [&>*:last-child]:border-ink">
                    {v.items.map((it, k) => (
                      <ItemCard key={it.id} it={it} n={k + 1} v={v} user={user.id} act={act} />
                    ))}
                  </div>
                )}
                {v.may.write && v.activities.length === 0 && <p className="mt-3 text-sm text-muted">{t("pw.noActivityNumbers")}</p>}
                {v.may.add && !adding && (
                  <button type="button" className={`${primary} mt-4 w-full sm:w-auto`} onClick={() => setAdding(true)}>
                    + Add an item
                  </button>
                )}
                {adding && v.may.add && (
                  <ItemForm
                    v={v}
                    className="mt-4"
                    onClose={() => setAdding(false)}
                    onSave={(u) => act({ action: "update", update: u }, "Added.").then(() => setAdding(false))}
                    onQueue={async (u, local) => {
                      await addToOutbox({
                        user: user.id,
                        project: project.id,
                        url: `/api/projects/${project.id}/results`,
                        label: `Weekly item: ${(u.title || u.note).slice(0, 40)}`,
                        action: { action: "update", update: u },
                        photos: Object.entries(local).map(([h, x]) => ({ local: h, ...x })),
                      });
                      setError("");
                      setNotice("Saved on this phone. It is sent, photos and all, when the connection is back.");
                      setAdding(false);
                    }}
                  />
                )}
              </section>
            )}

            {w.saved && v.items.length > 0 && (
              <section className="mt-8 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-4 font-ledger">
                <button type="button" className={primary} disabled={busy} onClick={() => void download()}>
                  {busy ? "Making the Word file…" : "Download for Word"}
                </button>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {v.items.length} {v.items.length === 1 ? "item" : "items"} · {photoCount} {photoCount === 1 ? "photo" : "photos"}
                </span>
                {v.may.send && (
                  <button
                    type="button"
                    className={`${primary} ms-auto`}
                    onClick={() => void askConfirm({ message: `Mark update #${w.n} as sent? It is locked after that: nothing dated ${periodLabel(w.from, w.to)} can be added or changed.`, confirm: "Mark as sent" }).then((ok) => (ok ? save({ action: "send", from: w.from }, `Update #${w.n} marked sent.`).catch(() => undefined) : undefined))}
                  >
                    Mark as sent
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
