import { NextResponse } from "next/server";
import { fxInput, LOCAL_CURRENCIES, rateText } from "@/lib/fx";
import { requireViewer } from "@/server/auth";
import { loadFx, mayRecordRates, recordRate } from "@/server/fx-store";
import { handle, readBody } from "@/server/guard";

/** The organization's monthly exchange rates (lib/fx, MF-11): staff read them; finance records them. */
function view(rates: Awaited<ReturnType<typeof loadFx>>["rates"], may: boolean) {
  const month = new Date().toISOString().slice(0, 7);
  return { month, may, now: Object.fromEntries(LOCAL_CURRENCIES.map((c) => [c, rateText(c, month, rates)])), rates: [...rates].sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency)) };
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Only staff see the exchange rates." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(view((await loadFx()).rates, mayRecordRates(v.user)), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayRecordRates, why: "Only finance records the month's exchange rate." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, fxInput, "Give the currency, the month, the rate per US dollar and where it comes from.");
    const { rates } = await recordRate(b, v.user);
    return NextResponse.json(view(rates, true));
  });
}
