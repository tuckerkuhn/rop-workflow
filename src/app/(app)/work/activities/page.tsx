import type { Metadata } from "next";
import { ActivitiesPage } from "@/components/work/activities-page";

export const metadata: Metadata = {
  title: "Activities · ROP Workflow",
  description: "ROP's workplan activities as they are carried out: owners, status, blockers and tasks.",
};

export default function Page() {
  return <ActivitiesPage />;
}
