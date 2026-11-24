import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsPage } from "@/components/ledger/payments-page";

export const metadata: Metadata = {
  title: "Record a payment · ROP Workflow",
  description: "A payment the project made, with its receipt and budget line, kept in the books.",
};

export default function Page() {
  return (
    <Suspense>
      <PaymentsPage />
    </Suspense>
  );
}
