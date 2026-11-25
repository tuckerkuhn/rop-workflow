"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { quietBtn } from "@/components/workspace/ui";
import { mapEmbed } from "@/lib/exif";
import { longDate } from "@/lib/weekly";
import type { DistFacts } from "@/server/distribution-photo";

/**
 * Where and when a field record was made, read from the phone and the photo: the same block on an
 * input distribution's approval page and on every KoboCollect form in the review queue. Nobody
 * typed any of it. The map is loaded only when asked for: showing it sends the point to
 * OpenStreetMap, and a GPS point is where a farmer lives.
 */
export function WhereWhen({ facts, compact = false }: { facts: DistFacts; compact?: boolean }) {
  const { tx } = useT();
  const [showMap, setShowMap] = useState(false);
  if (!facts.place && !facts.photo && !facts.missing.length && !facts.note) return null;
  const precise = facts.place?.lat !== undefined && facts.place.lon !== undefined;
  return (
    <>
      {!compact && <h2 className="font-medium">{tx("Where and when")}</h2>}
      <p className={`${compact ? "" : "mt-0.5 "}text-xs text-muted`}>{tx("Read from the phone and the photo. Nobody typed this.")}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {facts.place && (
          <li>
            ✓ {tx("Place captured from {source}.", { source: tx(facts.place.fromText) })}
            {precise && (
              <>
                {" "}
                <span className="font-mono text-xs text-muted">
                  {facts.place.lat!.toFixed(5)}, {facts.place.lon!.toFixed(5)}
                </span>
              </>
            )}
          </li>
        )}
        {facts.photo?.date && <li>✓ {tx("Photo taken {when}.", { when: `${longDate(facts.photo.date)}${facts.photo.time ? `, ${facts.photo.time}` : ""}` })}</li>}
        {facts.apart && (
          <li className={facts.apart.far ? "text-clay" : ""}>
            {facts.apart.far ? "!" : "✓"} {tx("The photo was taken {distance} from where the form was filled in.", { distance: facts.apart.text })}
            {facts.apart.far ? ` ${tx("Ask why before accepting it.")}` : ""}
          </li>
        )}
        {facts.dayDiffers && (
          <li className="text-clay">
            ! {tx("The form says {form}; the photo was taken {photo}. Ask which day it happened.", { form: longDate(facts.dayDiffers.form), photo: longDate(facts.dayDiffers.photo) })}
          </li>
        )}
        {facts.missing.map((m) => (
          <li key={m} className="text-muted">
            {tx(m)}
          </li>
        ))}
      </ul>
      {facts.note && (
        <p className="mt-3 border-s-[3px] border-ochre ps-2 text-sm">
          <span className="font-medium">{tx("Note from the field:")}</span> {facts.note}
        </p>
      )}
      {precise && (
        <div className="mt-3">
          {showMap ? (
            <iframe title={tx("Map of where it was recorded")} src={mapEmbed({ lat: facts.place!.lat!, lon: facts.place!.lon! })} className="h-56 w-full rounded-lg border border-line" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <>
              <button type="button" className={quietBtn} onClick={() => setShowMap(true)}>
                {tx("Show on a map")}
              </button>
              <p className="mt-1 text-xs text-muted">{tx("The map comes from OpenStreetMap. Opening it sends this point to their map service.")}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
