import type { Metadata } from "next";
import { ProgressPage } from "@/components/project/progress-page";

export const metadata: Metadata = {
  title: "Progress · ROP Workflow",
};

export default function Page() {
  return <ProgressPage />;
}
