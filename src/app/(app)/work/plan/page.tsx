import type { Metadata } from "next";
import { ProcurementPlanPage } from "@/components/procurement/plan-page";

export const metadata: Metadata = {
  title: "Procurement calendar · ROP Workflow",
  description: "Planned purchases from the budget, their approvals and start dates.",
};

export default function Page() {
  return <ProcurementPlanPage />;
}
