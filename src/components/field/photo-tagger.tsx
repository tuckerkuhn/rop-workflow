"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { mapEmbed, photoFacts, type Point } from "@/lib/exif";
import { TAG_RULES, tagLabels, type PhotoTag } from "@/lib/kobo-photo";

/**
 * Adding a photo in the app, for office staff (field staff tag by taking the photo on the right
 * question in KoboCollect). Three taps and nothing typed:
 *
 *   1. Take or choose the photo. Its day, time and place are read from the photo itself.
 *   2. Pick one tag. The tag decides where the photo is filed and what it sets going, and the
 *      screen says so before anything is saved. A screen that already knows the tag (the signed
 *      note on a distribution) passes `preset` and this step is skipped.
 *   3. Save.
 *
 * When the photo holds no place (many phones and apps remove it), one tap uses this device's
 * location instead, or the photo is saved without one. Coordinates are shown only to people who
 * may see participant names (`precise`).
 */

export type Shot = {
  src: string;
  tag: PhotoTag;
  taken: { date: string; time: string | null } | null;
  gps: Point | null;
  /** Where the place came from, for the record. */
  placeFrom: "photo" | "device" | null;
};

/** The photo resized on the phone (long side at most `maxEdge` pixels) and kept as a JPEG data URL. Drops the EXIF data: read it first. */
export async function shrinkPhoto(file: File, q: { maxEdge: number; jpeg: number }): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, q.maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", q.jpeg);
}

/** What the photo says about itself, then the photo shrunk for upload. The order matters: shrinking drops the EXIF data. */
export async function readPhoto(file: File, q: { maxEdge: number; jpeg: number }) {
  const facts = photoFacts(await file.arrayBuffer());
  return { src: await shrinkPhoto(file, q), taken: facts.date ? { date: facts.date, time: facts.time } : null, gps: facts.gps };
}

const TOO_BIG = 25_000_000;

export function PhotoTagger({
  tags,
  preset,
  quality,
  precise,
  saveLabel,
  onSave,
  onCancel,
}: {
  /** The tags offered. Ignored when `preset` is given. */
  tags: PhotoTag[];
  /** The screen already knows what this photo is: no tag is asked. */
  preset?: PhotoTag;
  quality: { maxEdge: number; jpeg: number };
  /** The viewer may see coordinates and the map. */
  precise: boolean;
  saveLabel?: string;
  onSave: (shot: Shot) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const { tx } = useT();
  const [shot, setShot] = useState<Omit<Shot, "tag"> | null>(null);
  const [tag, setTag] = useState<PhotoTag | null>(preset ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > TOO_BIG) return setError(tx("That photo is too large. Choose one under 25 MB."));
    setBusy(true);
    setError("");
    try {
      const r = await readPhoto(file, quality);
      setShot({ ...r, placeFrom: r.gps ? "photo" : null });
      setShowMap(false);
    } catch {
      setError(tx("That file could not be read as a photo. Try another."));
    } finally {
      setBusy(false);
    }
  }

  function useDevice() {
    if (!navigator.geolocation) return setError(tx("This device cannot give its location. The photo can be saved without a place."));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setShot((s) => (s ? { ...s, gps: { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lon: Math.round(pos.coords.longitude * 1e6) / 1e6 }, placeFrom: "device" } : s));
      },
      () => {
        setLocating(false);
        setError(tx("The device did not give its location. The photo can be saved without a place."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  async function save() {
    if (!shot || !tag) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ ...shot, tag });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const when = shot?.taken ? `${shot.taken.date}${shot.taken.time ? ` ${shot.taken.time}` : ""}` : "";
  return (
    <div className="mt-3 bg-sunken p-4">
      {!shot ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${primaryBtn} inline-flex min-h-12 cursor-pointer items-center text-base font-bold`}>
            {busy ? tx("Reading the photo…") : tx("Take or choose photo")}
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void choose(f); }} />
          </label>
          {onCancel && (
            <button type="button" onClick={onCancel} className="min-h-12 px-3 text-base font-bold text-muted hover:text-ink">
              {tx("Cancel")}
            </button>
          )}
          <p className="w-full text-xs text-muted">{tx("The day, time and place are read from the photo. You type nothing.")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on this device */}
            <img src={shot.src} alt={tx("The photo you chose")} className="h-32 w-32 border border-line bg-mist object-cover" />
            <ul className="min-w-48 flex-1 space-y-1 text-sm">
              <li>{when ? `✓ ${tx("Taken {when}.", { when })}` : tx("The photo does not say when it was taken, so it is filed under today.")}</li>
              <li>
                {shot.gps
                  ? `✓ ${shot.placeFrom === "device" ? tx("Place taken from this device.") : tx("Place found in the photo.")}`
                  : tx("No place in this photo. Many phones and apps remove it.")}
                {shot.gps && precise && (
                  <span className="ms-1 font-mono text-xs text-muted">
                    {shot.gps.lat.toFixed(5)}, {shot.gps.lon.toFixed(5)}
                  </span>
                )}
              </li>
              {!shot.gps && (
                <li>
                  <button type="button" className={quietBtn} disabled={locating} onClick={useDevice}>
                    {locating ? tx("Finding this device…") : tx("Use this device’s location")}
                  </button>
                  <span className="ms-2 text-xs text-muted">{tx("Only if you are where the photo was taken.")}</span>
                </li>
              )}
              {shot.gps && precise && !showMap && (
                <li>
                  <button type="button" className="font-semibold text-forest underline-offset-4 hover:underline" onClick={() => setShowMap(true)}>
                    {tx("Show on a map")}
                  </button>
                </li>
              )}
            </ul>
          </div>
          {shot.gps && precise && showMap && <iframe title={tx("Map of where the photo was taken")} src={mapEmbed(shot.gps)} className="mt-3 h-48 w-full border border-line" loading="lazy" referrerPolicy="no-referrer" />}

          {!preset && (
            <fieldset className="mt-4">
              <legend className="text-sm font-bold">{tx("What is this a photo of?")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={tag === k}
                    onClick={() => setTag(k)}
                    className={`min-h-12 border-2 px-3 text-base font-bold ${tag === k ? "border-forest bg-forest text-white" : "border-line-strong bg-surface text-ink hover:border-forest"}`}
                  >
                    {tx(tagLabels[k])}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {tag && (
            <p className="mt-3 border-s-[6px] border-ochre ps-2 text-sm">
              <span className="font-bold">{tx("What happens next:")}</span> {tx(TAG_RULES[tag].next)}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={`${primaryBtn} min-h-12 text-base font-bold`} disabled={busy || !tag} onClick={() => void save()}>
              {busy ? tx("Saving…") : (saveLabel ?? tx("Save photo"))}
            </button>
            <button type="button" className="min-h-12 px-3 text-base font-bold text-muted hover:text-ink" onClick={() => { setShot(null); setTag(preset ?? null); }}>
              {tx("Choose another")}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="min-h-12 px-3 text-base font-bold text-muted hover:text-ink">
                {tx("Cancel")}
              </button>
            )}
            {!tag && <span className="text-xs text-muted">{tx("Pick one tag to save.")}</span>}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-clay">{error}</p>}
    </div>
  );
}

/** How a tag is kept on a farmer's photo: the activity it shows, and whether it is the signed goods received note. */
export const filedAs = (tag: PhotoTag): { activity: "training" | "landprep" | "visit" | "distribution" | "planting"; signedNote?: true } =>
  tag === "signed-note" ? { activity: "distribution", signedNote: true } : tag === "delivery" ? { activity: "distribution" } : tag === "receipt" ? { activity: "visit" } : { activity: tag };
