import type { Metadata } from "next";
import { FieldWorkspace } from "@/components/field/workspace";

export const metadata: Metadata = {
  title: "Field activities · ROP Workflow",
  description: "Field activities: each person's queue of farmers and findings, and the next step for each.",
};

export default function FieldPage() {
  return <FieldWorkspace />;
}
