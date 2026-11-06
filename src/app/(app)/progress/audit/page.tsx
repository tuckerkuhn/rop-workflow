import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditPage } from "@/components/progress/audit-page";

export const metadata: Metadata = {
  title: "Audit trail · ROP Workflow",
  description: "Who recorded, accepted, changed, imported, drafted, signed off and released what, for one project and period.",
};

export default function Page() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
