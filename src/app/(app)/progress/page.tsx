import type { Metadata } from "next";
import { ProgressPage } from "@/components/progress/progress-page";

export const metadata: Metadata = {
  title: "Progress · ROP Workflow",
  description: "Indicators, impact and the donor report for the current project.",
};

export default function Page() {
  return <ProgressPage />;
}
