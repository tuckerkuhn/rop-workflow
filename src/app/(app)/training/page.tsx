import type { Metadata } from "next";
import { TrainingPage } from "@/components/people/training-page";

export const metadata: Metadata = {
  title: "Training log · ROP Workflow",
  description: "Each training given to staff with its proof, who is due an induction or a yearly refresher, and each person's priorities for the year.",
};

export default function Page() {
  return <TrainingPage />;
}
