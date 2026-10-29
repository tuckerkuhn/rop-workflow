import type { Metadata } from "next";
import { ProjectPage } from "@/components/project/project-page";

export const metadata: Metadata = {
  title: "Project · ROP Workflow",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPage id={id} />;
}
