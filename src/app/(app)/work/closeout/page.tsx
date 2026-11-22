import type { Metadata } from "next";
import { CloseoutPage } from "@/components/procurement/closeout-page";

export const metadata: Metadata = {
  title: "Monthly closeout · ROP Workflow",
  description: "Expense vouchers by month, filed in the file store and posted in the accounting system.",
};

export default function Page() {
  return <CloseoutPage />;
}
