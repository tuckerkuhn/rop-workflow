import type { Metadata } from "next";
import { Suspense } from "react";
import { BudgetPage } from "@/components/progress/budget-page";

export const metadata: Metadata = {
  title: "Budget vs actual · ROP Workflow",
  description: "Spending against the approved budget by activity, with the forecast and the lines to explain.",
};

export default function Page() {
  return (
    <Suspense>
      <BudgetPage />
    </Suspense>
  );
}
