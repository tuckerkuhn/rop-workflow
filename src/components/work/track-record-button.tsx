"use client";

import { useState } from "react";
import { quietBtn } from "@/components/workspace/ui";
import type { TrackRecord } from "@/server/track-record";
import { trackRecordDocx, type TrackImages } from "@/lib/track-record-docx";

/** Downloads ROP's track record (Word) for a proposal: projects, accepted results, consented stories. */
export function TrackRecordButton({ user }: { user: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/track-record", { headers: { "x-demo-user": user } });
      const t = (await r.json()) as TrackRecord & { error?: string };
      if (!r.ok) throw new Error(t.error ?? "Could not make the track record.");
      const images: TrackImages = new Map();
      for (const st of t.projects.flatMap((p) => p.stories)) {
        if (!st.photo) continue;
        const res = await fetch(`/api/files/${st.photo.hash}`, { headers: { "x-demo-user": user } });
        if (!res.ok) continue;
        const bmp = await createImageBitmap(await res.blob());
        const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
        if (blob) images.set(st.photo.hash, { data: await blob.arrayBuffer(), width: c.width, height: c.height });
      }
      const doc = await trackRecordDocx(t, images);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(doc);
      a.download = `ROP track record ${t.asOf}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" className={quietBtn} disabled={busy} onClick={() => void run()}>
        {busy ? "Making the track record…" : "Track record (Word)"}
      </button>
      {err && <span className="mt-1 text-xs text-clay">{err}</span>}
    </span>
  );
}
