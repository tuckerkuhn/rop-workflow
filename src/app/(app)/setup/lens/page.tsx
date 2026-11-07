import type { Metadata } from "next";
import { Suspense } from "react";
import { LensPage } from "@/components/setup/lens-page";

export const metadata: Metadata = {
  title: "Lens review · ROP Workflow",
  description: "The project plan read through ROP's reviewer lenses, with a decision on every finding.",
};

export default function Page() {
  return (
    <Suspense>
      <LensPage />
    </Suspense>
  );
}
