import type { Metadata } from "next";
import { TargetDetailsPage } from "@/components/progress/target-details-page";

export const metadata: Metadata = {
  title: "Target details · ROP Workflow",
  description: "Each target's baseline, breakdown, proof documents, budget line and workplan step.",
};

export default function Page() {
  return <TargetDetailsPage />;
}
