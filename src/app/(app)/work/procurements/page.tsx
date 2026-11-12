import type { Metadata } from "next";
import { ProcurementBoardPage } from "@/components/procurement/board-page";

export const metadata: Metadata = { title: "Large procurements · ROP Workflow", description: "Every large procurement in your projects, by step." };

export default function Page() {
  return <ProcurementBoardPage />;
}
