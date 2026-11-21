import type { Metadata } from "next";
import { Suspense } from "react";
import { DonorReportPage } from "@/components/donor/report-page";

export const metadata: Metadata = {
  title: "Quarterly report · ROP Workflow",
  description: "A released quarterly report: each figure with its records, and how the grant is being spent.",
};

export default async function Page({ params }: { params: Promise<{ quarter: string }> }) {
  const { quarter } = await params;
  return (
    <Suspense>
      <DonorReportPage quarter={quarter} />
    </Suspense>
  );
}
