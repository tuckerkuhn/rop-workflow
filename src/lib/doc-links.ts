import { z } from "zod";

/**
 * Links to where a document lives (SharePoint, Google Drive, OneDrive, or anywhere else on the
 * web): the interview write-up, the consent scan, the draft for the newsletter. The app keeps the
 * link and a name; the file stays where the team works on it, with that service's own access.
 */

export type DocLink = { url: string; title: string };

export const MAX_DOC_LINKS = 10;

/** A web address that opens in a browser: https only, no spaces. */
export const isDocUrl = (u: string) => {
  const t = u.trim();
  if (!/^https:\/\/\S+$/i.test(t) || t.length > 1000) return false;
  try {
    return !!new URL(t).hostname.includes(".");
  } catch {
    return false;
  }
};

/** Where the link opens, in words people know. */
export function docSource(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Link";
  }
  if (host.endsWith(".sharepoint.com")) return /-my\.sharepoint\.com$/.test(host) ? "OneDrive" : "SharePoint";
  if (host === "onedrive.live.com" || host === "1drv.ms") return "OneDrive";
  if (host === "drive.google.com") return "Google Drive";
  if (host === "docs.google.com") return "Google Docs";
  if (host.endsWith("dropbox.com")) return "Dropbox";
  return host.replace(/^www\./, "");
}

/** The name shown when none was typed: the service, so the list never shows a bare address. */
export const docTitle = (d: DocLink) => d.title.trim() || `Document in ${docSource(d.url)}`;

/**
 * Whether a document link's address names the person: any word of their name (three letters or
 * more) in the address as written or decoded. SharePoint and Drive addresses carry the file name.
 */
export function docNamesPerson(url: string, name: string): boolean {
  let plain = url;
  try {
    plain = decodeURIComponent(url);
  } catch {
    /* kept as written */
  }
  const hay = `${url} ${plain}`.toLowerCase().replace(/[+_.-]/g, " ");
  return name
    .toLowerCase()
    .split(/\s+/)
    .some((w) => w.length >= 3 && hay.includes(w));
}

export const docLinkSchema = z.object({
  url: z.string().trim().max(1000).refine(isDocUrl, "A document link must be a full web address starting with https://."),
  title: z.string().trim().max(200),
});
export const docLinksSchema = z.array(docLinkSchema).max(MAX_DOC_LINKS);
