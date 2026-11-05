import type { Metadata } from "next";
import { PayrollPage } from "@/components/people/payroll-page";

export const metadata: Metadata = {
  title: "Payroll · ROP Workflow",
  description: "Monthly payroll from the HR record and approved timesheets, signed before any file goes to ADP or the bank.",
};

export default function Page() {
  return <PayrollPage />;
}
