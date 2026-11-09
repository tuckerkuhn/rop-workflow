import type { Metadata } from "next";
import { Suspense } from "react";
import { PreflightPage } from "@/components/progress/preflight-page";

export const metadata: Metadata = {
  title: "Pre-flight · ROP Workflow",
  description: "Everything that stands between a report and the donor, before it is downloaded or released.",
};

export default function Page() {
  return (
    <Suspense>
      <PreflightPage />
    </Suspense>
  );
}
