import { redirect } from "next/navigation";

/** The report check now sits on each report. Old links land on the right report, at its check. */
export default async function Page({ searchParams }: { searchParams: Promise<{ report?: string; period?: string }> }) {
  const { report, period } = await searchParams;
  const p = period ?? "";
  if (report === "annual") redirect(`/progress/annual${/^\d{4}$/.test(p) ? `?year=${p}` : ""}#checks`);
  if (report === "face") redirect(`/progress/face${/^\d{4}-\d{2}$/.test(p) ? `?month=${p}` : ""}#checks`);
  redirect(`/progress/report${/^\d{4}-Q[1-4]$/.test(p) ? `?q=${p}` : ""}#checks`);
}
