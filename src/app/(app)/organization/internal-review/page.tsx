import type { Metadata } from "next";
import { InternalReviewPage } from "@/components/organization/internal-review-page";

export const metadata: Metadata = {
  title: "Internal review · ROP Workflow",
  description: "The quarterly internal review of a country office: the sample, who tests it, the cycle and the findings log.",
};

export default function Page() {
  return <InternalReviewPage />;
}
