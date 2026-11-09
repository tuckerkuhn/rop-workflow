import type { Metadata } from "next";
import { Suspense } from "react";
import { WeeklyPage } from "@/components/progress/weekly-page";

export const metadata: Metadata = {
  title: "Weekly update · ROP Workflow",
  description: "What happened this week, with dated photos, downloaded as the Word document sent to the donor.",
};

export default function Page() {
  return (
    <Suspense>
      <WeeklyPage />
    </Suspense>
  );
}
