import type { Metadata } from "next";
import { DesignPage } from "@/components/design/design-page";

export const metadata: Metadata = {
  title: "Project design · ROP Workflow",
  description: "Find the trade window with the best validated opportunity, then commit a project to it.",
};

export default function Page() {
  return <DesignPage />;
}
