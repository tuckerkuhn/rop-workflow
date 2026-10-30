import { handle } from "@/server/guard";
import { farmersCsv } from "@/server/kobo";

/** farmers.csv for the Kobo forms: farmer ID, village and household-head initials. Never names. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("project") ?? "A-2027";
  return handle(async () => new Response(await farmersCsv(code), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="farmers.csv"' } }));
}
