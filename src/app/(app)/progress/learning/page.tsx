import type { Metadata } from "next";
import { LearningPage } from "@/components/progress/learning-page";

export const metadata: Metadata = {
  title: "Lessons and close-out · ROP Workflow",
  description: "Lessons learned as the project runs, and the checklist that closes it.",
};

export default function Page() {
  return <LearningPage />;
}
