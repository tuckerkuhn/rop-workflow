import { afterEach, describe, expect, it } from "vitest";
import { blockers, type VoucherItem } from "@/lib/closeout";
import { setClientStores, storeSet } from "@/lib/file-store";

/** ISS-23 and ISS-24: month close with the app's own books, and with file links optional. */
const v = (sharepointUrl: string, netsuiteRef: string): VoucherItem => ({ id: "PR-1", kind: "procurement", title: "Seed", payee: "Supplier", amountUsd: 100, voucher: { number: "V-1", month: "2026-11", sharepointUrl, netsuiteRef }, filed: true, stage: "Paid" });
afterEach(() => setClientStores(storeSet(null)));

describe("what stops a month closing", () => {
  it("with no outside accounting system named, the app's own books are the books: no posting reference is asked", () => {
    setClientStores({ ...storeSet(null), accounting: "" });
    expect(blockers([v("", "")])).toEqual([]);
    setClientStores({ ...storeSet(null), accounting: "NetSuite" });
    expect(blockers([v("", "")])).toEqual(["PR-1: not posted in NetSuite"]);
  });

  it("a link to the filed voucher is needed only when the organization asks for it", () => {
    setClientStores({ ...storeSet(["sharepoint"]), accounting: "", linksRequired: true });
    expect(blockers([v("", "")])).toEqual(["PR-1: not filed in SharePoint"]);
    setClientStores({ ...storeSet(["sharepoint"]), accounting: "" });
    expect(blockers([v("", "")])).toEqual([]);
  });
});
