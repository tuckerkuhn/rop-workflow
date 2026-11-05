import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsPage } from "@/components/progress/results-page";

export const metadata: Metadata = {
  title: "Results · ROP Workflow",
  description: "Results recorded with their proof, checked by MEL.",
};

export default function Page() {
  return (
    <Suspense>
      <ResultsPage />
    </Suspense>
  );
}
