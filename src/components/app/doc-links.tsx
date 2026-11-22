"use client";

import { AnyLinkCaution } from "@/components/app/any-link-caution";
import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { MAX_DOC_LINKS, docSource, docTitle, isDocUrl, type DocLink } from "@/lib/doc-links";

const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";

/**
 * The documents a record points to, each opening where it lives (SharePoint, Google Drive...).
 * With `onChange`, people who may edit the record add and remove links here. `mask` hides names
 * in a link's name from people who may not see them (lib/field maskName).
 */
export function DocLinks({ docs, onChange, mask = (t) => t, className = "" }: { docs: DocLink[] | undefined; onChange?: (next: DocLink[]) => void; mask?: (t: string) => string; className?: string }) {
  const { tx } = useT();
  const list = docs ?? [];
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  if (!list.length && !onChange) return null;
  const add = () => {
    if (!isDocUrl(url)) return setErr(tx("Paste the full link from SharePoint, Google Drive or wherever the document is, starting with https://."));
    if (list.some((d) => d.url === url.trim())) return setErr(tx("That document is already linked."));
    onChange!([...list, { url: url.trim(), title: title.trim() }]);
    setUrl("");
    setTitle("");
    setErr("");
    setAdding(false);
  };
  return (
    <div className={className}>
      {list.length > 0 && (
        <ul className="space-y-1">
          {list.map((d) => (
            <li key={d.url} className="flex items-center gap-2 text-sm">
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-medium text-forest hover:underline">
                {mask(docTitle(d))}
              </a>
              <span className="shrink-0 text-xs text-muted">{docSource(d.url)} ↗</span>
              {onChange && (
                <button type="button" className="ms-auto shrink-0 text-muted hover:text-clay" aria-label={tx("Remove the link to {name}", { name: mask(docTitle(d)) })} onClick={() => onChange(list.filter((x) => x.url !== d.url))}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onChange &&
        list.length < MAX_DOC_LINKS &&
        (adding ? (
          <div className="mt-2 space-y-2">
            <input className={input} type="url" inputMode="url" autoFocus placeholder={tx("Link to the document (SharePoint, Google Drive…)")} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
            <input className={input} placeholder={tx("Name (optional), e.g. Interview notes")} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
            <AnyLinkCaution />
            {err && <p className="text-xs text-clay">{err}</p>}
            <div className="flex gap-3 text-sm">
              <button type="button" className="font-semibold text-forest hover:underline" onClick={add}>
                {tx("Add link")}
              </button>
              <button type="button" className="text-muted hover:text-ink" onClick={() => (setAdding(false), setErr(""), setUrl(""), setTitle(""))}>
                {tx("Cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mt-1 text-sm text-muted hover:text-forest" onClick={() => setAdding(true)}>
            {tx("+ Link a document")}
          </button>
        ))}
    </div>
  );
}
