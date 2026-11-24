import { NextResponse } from "next/server";
import { LedgerError } from "@/server/ledger";
import { LedgerRuleError } from "@/lib/ledger/rules";

/** A ledger refusal as a plain answer with a fitting status; anything else is thrown on to `handle`. */
export function refusal(e: unknown): NextResponse {
  if (e instanceof LedgerRuleError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof LedgerError) {
    const status = e.code === "invalid" ? 400 : e.code === "not_found" ? 404 : 409;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  throw e;
}
