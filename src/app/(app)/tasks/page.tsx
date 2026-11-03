import type { Metadata } from "next";
import { TasksPage } from "@/components/tasks/tasks-page";

export const metadata: Metadata = {
  title: "Tasks · ROP Workflow",
  description: "Field activities and procurement steps for the current project.",
};

export default function Page() {
  return <TasksPage />;
}
