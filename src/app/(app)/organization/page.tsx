import type { Metadata } from "next";
import { OrgHub } from "@/components/organization/org-hub";

export const metadata: Metadata = { title: "Organization · ROP Workflow", description: "Running Roots of Peace: people, pay, purchasing and rules." };

export default function Page() {
  return <OrgHub />;
}
