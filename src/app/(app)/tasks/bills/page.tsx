import type { Metadata } from "next";
import { BillsPage } from "@/components/procurement/bills-page";

export const metadata: Metadata = {
  title: "Bills · ROP Workflow",
  description: "Bills paid directly, outside procurement: recorded with the document, approved, vouchered and closed each month.",
};

export default function Page() {
  return <BillsPage />;
}
