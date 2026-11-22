import { describe, expect, it } from "vitest";
import { NO_ORG, cleanStores, isFileLink, isRecordedFileLink, storeSet, storeNames } from "@/lib/file-store";
import { isSharePointUrl } from "@/lib/procurement";

const SP = "https://rootsofpeace.sharepoint.com/sites/acrp/voucher-12.pdf";
const GD = "https://drive.google.com/file/d/abc123/view";
const DB = "https://www.dropbox.com/s/abc/list.pdf";
const OTHER = "https://files.example.org/list.pdf";

describe("where an organization keeps its files", () => {
  it("takes only SharePoint links unless the organization says otherwise", () => {
    expect(isFileLink(SP)).toBe(true);
    expect(isFileLink(GD)).toBe(false);
    expect(isFileLink(OTHER)).toBe(false);
    expect(isSharePointUrl(SP)).toBe(true);
    expect(isSharePointUrl(GD)).toBe(false);
  });
  it("takes links from each store the organization chose, and no other", () => {
    expect(isFileLink(GD, ["gdrive"])).toBe(true);
    expect(isFileLink("https://docs.google.com/spreadsheets/d/abc", ["gdrive"])).toBe(true);
    expect(isFileLink(SP, ["gdrive"])).toBe(false);
    expect(isFileLink(DB, ["gdrive", "dropbox"])).toBe(true);
    expect(isFileLink("https://1drv.ms/b/s!abc", ["onedrive"])).toBe(true);
    expect(isFileLink("https://drive.google.com.evil.example/file", ["gdrive"])).toBe(false);
  });
  it("any secure link takes https links only", () => {
    expect(isFileLink(OTHER, ["any"])).toBe(true);
    expect(isFileLink("http://files.example.org/list.pdf", ["any"])).toBe(false);
    expect(isFileLink("files.example.org/list.pdf", ["any"])).toBe(false);
    expect(isFileLink("https://localhost/list.pdf", ["any"])).toBe(false);
    expect(isFileLink("", ["any"])).toBe(false);
  });
  it("falls back to SharePoint when nothing valid is set, so evidence is never unchecked", () => {
    expect(cleanStores(undefined)).toEqual(["sharepoint"]);
    expect(cleanStores([])).toEqual(["sharepoint"]);
    expect(cleanStores(["nonsense"])).toEqual(["sharepoint"]);
    expect(cleanStores(["dropbox", "gdrive"])).toEqual(["gdrive", "dropbox"]);
  });
  it("names the stores for a sentence", () => {
    expect(storeNames(["sharepoint"])).toBe("SharePoint");
    expect(storeNames(["gdrive", "dropbox"])).toBe("Google Drive or Dropbox");
    expect(storeNames(["sharepoint", "gdrive", "dropbox"])).toBe("SharePoint, Google Drive or Dropbox");
    expect(storeNames(["any", "gdrive"])).toBe("your file store");
  });
  it("keeps proof recorded under an earlier setting: new links take today's stores, recorded ones any store used", () => {
    // Started on the default (SharePoint), moved to Google Drive.
    const set = storeSet(["gdrive"], [["gdrive"]]);
    expect(set.now).toEqual(["gdrive"]);
    expect(set.ever).toEqual(["sharepoint", "gdrive"]);
    expect(isFileLink(SP, set.now)).toBe(false);
    expect(isRecordedFileLink(SP, set.ever)).toBe(true);
    expect(isRecordedFileLink(DB, set.ever)).toBe(false);
    // Any secure link once allowed, then taken away: what was recorded then still counts.
    const after = storeSet(["sharepoint"], [["sharepoint", "any"], ["sharepoint"]]);
    expect(isFileLink(OTHER, after.now)).toBe(false);
    expect(isRecordedFileLink(OTHER, after.ever)).toBe(true);
  });
  it("outside any organization takes new links from the default and recorded proof from any named store", () => {
    expect(NO_ORG.now).toEqual(["sharepoint"]);
    expect(isRecordedFileLink(GD, NO_ORG.ever)).toBe(true);
    expect(isRecordedFileLink(OTHER, NO_ORG.ever)).toBe(false);
  });
});
