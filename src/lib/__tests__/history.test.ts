import { describe, expect, it } from "vitest";
import { sameHistory, stampHistory } from "@/lib/history";

const e = (what: string, at?: string) => ({ date: "2026-11-20", what, ...(at ? { at } : {}) });
const now = new Date("2026-11-20T09:42:00Z");

describe("history save times", () => {
  it("stamps new entries with the server's time and keeps the stored ones' times", () => {
    const stored = [e("Request created", "2026-11-20T08:00:00.000Z")];
    const sent = [e("Request created"), e("Requisition submitted", "2030-01-01T00:00:00.000Z")];
    const out = stampHistory(stored, sent, now);
    expect(out[0].at).toBe("2026-11-20T08:00:00.000Z");
    // A time sent by the screen is never taken.
    expect(out[1].at).toBe("2026-11-20T09:42:00.000Z");
  });

  it("matches a screen's copy without times to the stored history", () => {
    expect(sameHistory([e("A")], [e("A", "2026-11-20T08:00:00.000Z")])).toBe(true);
    expect(sameHistory([e("A")], [e("B", "2026-11-20T08:00:00.000Z")])).toBe(false);
  });

  it("does not give an old entry a new time when it was changed", () => {
    const out = stampHistory([e("A", "2026-11-20T08:00:00.000Z")], [e("A changed")], now);
    expect(out[0].at).toBeUndefined();
  });
});
