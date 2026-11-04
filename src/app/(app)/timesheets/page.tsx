import type { Metadata } from "next";
import { TimesheetPage } from "@/components/people/timesheet-page";

export const metadata: Metadata = {
  title: "Timesheets · ROP Workflow",
  description: "Monthly hours per funding source, leave and allowance days, approved by the supervisor.",
};

export default function Page() {
  return <TimesheetPage />;
}
