import type { Metadata } from "next";
import { ResourcesPage } from "@/components/resources/resources-page";

export const metadata: Metadata = {
  title: "Resources · ROP Workflow",
};

export default function Page() {
  return <ResourcesPage />;
}
