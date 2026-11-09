import type { Metadata } from "next";
import { OrgAudit } from "@/components/organization/org-audit";

export const metadata: Metadata = { title: "Organization audit log · ROP Workflow", description: "Every change in the Organization area." };

export default function Page() {
  return <OrgAudit />;
}
