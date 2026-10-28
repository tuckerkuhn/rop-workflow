import type { Metadata } from "next";
import { ProcurementWorkspace } from "@/components/procurement/workspace";

export const metadata: Metadata = {
  title: "Procurement · ROP Workflow",
  description: "Procurement workspace: each person's queue, the next step, and what it needs, from request to payment-ready.",
};

export default function ProcurementPage() {
  return <ProcurementWorkspace />;
}
