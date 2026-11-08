import type { Metadata } from "next";
import { PeriodReportPage } from "@/components/progress/period-report-page";

export const metadata: Metadata = {
  title: "Annual and final reports · ROP Workflow",
  description: "The year's or the whole project's results against targets and baselines, with evidence links, narrative, lessons and spending.",
};

export default function Page() {
  return <PeriodReportPage />;
}
