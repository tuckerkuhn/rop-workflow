import type { Metadata } from "next";
import { TasksPage } from "@/components/tasks/tasks-page";

export const metadata: Metadata = {
  title: "Work · ROP Workflow",
  description: "Start, continue and review work on the current project: tasks, field activities and procurement.",
};

export default function Page() {
  return <TasksPage />;
}
