import type { Metadata } from "next";
import { Suspense } from "react";
import { DonorPeriodReportPage } from "@/components/donor/period-report-page";
import { DonorReportPage } from "@/components/donor/report-page";

export const metadata: Metadata = {
  title: "Released report · ROP Workflow",
  description: "A released quarterly, annual or final report, as Roots of Peace released it.",
};

export default async function Page({ params }: { params: Promise<{ quarter: string }> }) {
  const { quarter } = await params;
  return (
    <Suspense>
      {/* "annual-2026" or "final": a released annual or final report. */}
      {/^\d{4}-Q[1-4]$/.test(quarter) ? <DonorReportPage quarter={quarter} /> : <DonorPeriodReportPage slug={quarter} />}
    </Suspense>
  );
}
