import type { Metadata } from "next";
import { CloseoutPage } from "@/components/procurement/closeout-page";

export const metadata: Metadata = {
  title: "Monthly closeout · ROP Workflow",
  description: "Expense vouchers by month, filed in SharePoint and posted in NetSuite.",
};

export default function Page() {
  return <CloseoutPage />;
}
