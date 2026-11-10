import type { Metadata } from "next";
import { FrameworkPage } from "@/components/progress/framework-page";

export const metadata: Metadata = {
  title: "Results framework · ROP Workflow",
  description: "Goal, outcomes, outputs, activities and targets as a tree, with this year's progress.",
};

export default function Page() {
  return <FrameworkPage />;
}
