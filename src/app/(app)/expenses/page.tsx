import type { Metadata } from "next";
import { ExpensePage } from "@/components/people/expense-page";

export const metadata: Metadata = {
  title: "Expenses · ROP Workflow",
  description: "Monthly expense reports with receipts, approved by the supervisor and Finance, reimbursed through payroll.",
};

export default function Page() {
  return <ExpensePage />;
}
