"use client";

import { useEffect, useState } from "react";

/**
 * A proof photo, wherever it is kept (server/file-store): a picture inside the record is shown as it
 * is; one in file storage ("file:<fingerprint>") is fetched for the person signed in, and its
 * fingerprint is checked by the server as it is read.
 */
export function useStoredPhoto(code: string, src: string | null | undefined, user: string | undefined) {
  const ref = src && /^file:[0-9a-f]{64}$/.test(src) ? src.slice(5) : "";
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!ref) return;
    let made = "";
    fetch(`/api/projects/${encodeURIComponent(code)}/photos/${ref}`, { headers: { "x-demo-user": user ?? "" } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && setUrl((made = URL.createObjectURL(b))))
      .catch(() => undefined);
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [code, ref, user]);
  return ref ? url : (src ?? "");
}

export function StoredPhoto({ code, src, user, alt, className }: { code: string; src: string | null | undefined; user: string | undefined; alt: string; className?: string }) {
  const shown = useStoredPhoto(code, src, user);
  // eslint-disable-next-line @next/next/no-img-element -- a stored photo or data URL, not a static asset
  return shown ? <img src={shown} alt={alt} className={className} /> : <div className={`${className ?? ""} bg-sunken`} aria-label={alt} />;
}
