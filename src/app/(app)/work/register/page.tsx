import type { Metadata } from "next";
import { ProcurementRegisterPage } from "@/components/procurement/register-page";

export const metadata: Metadata = {
  title: "Procurement register · ROP Workflow",
  description: "Every purchase on one page, with a monthly report and a spreadsheet download for donors and auditors.",
};

export default function Page() {
  return <ProcurementRegisterPage />;
}
