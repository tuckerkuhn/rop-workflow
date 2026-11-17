import type { Metadata } from "next";
import { Suspense } from "react";
import { ProposalsPage } from "@/components/work/proposals-page";

export const metadata: Metadata = { title: "Proposals · ROP Workflow", description: "From a matched opportunity to submitted: what the call requires, who owns each item and how it would score." };

export default function Page() {
  return (
    <Suspense>
      <ProposalsPage />
    </Suspense>
  );
}
