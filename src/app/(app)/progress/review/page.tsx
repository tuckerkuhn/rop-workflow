import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewPage } from "@/components/progress/review-page";

export const metadata: Metadata = {
  title: "Monthly review · ROP Workflow",
  description: "Results against targets and the workplan, money against the budget, and changes to the plan approved by a second reviewer.",
};

export default function Page() {
  return (
    <Suspense>
      <ReviewPage />
    </Suspense>
  );
}
