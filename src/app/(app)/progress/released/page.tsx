import type { Metadata } from "next";
import { Suspense } from "react";
import { DonorReportsPage } from "@/components/donor/reports-page";

export const metadata: Metadata = {
  title: "Reports · ROP Workflow",
  description: "The quarterly reports Roots of Peace has released, with how the grant is being spent.",
};

export default function Page() {
  return (
    <Suspense>
      <DonorReportsPage />
    </Suspense>
  );
}
