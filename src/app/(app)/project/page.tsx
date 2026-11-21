import type { Metadata } from "next";
import { ProjectHub } from "@/components/project/project-hub";

export const metadata: Metadata = {
  title: "Projects · ROP Workflow",
  description: "The current project in one place: the work, progress against targets, reports and set-up.",
};

export default function Page() {
  return <ProjectHub />;
}
