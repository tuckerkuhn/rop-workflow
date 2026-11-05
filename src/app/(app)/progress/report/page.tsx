import type { Metadata } from "next";
import { Suspense } from "react";
import { QprPage } from "@/components/progress/qpr-page";

export const metadata: Metadata = {
  title: "Quarterly report · ROP Workflow",
  description: "The donor's quarterly progress report, with every figure linked to its evidence.",
};

export default function Page() {
  return (
    <Suspense>
      <QprPage />
    </Suspense>
  );
}
