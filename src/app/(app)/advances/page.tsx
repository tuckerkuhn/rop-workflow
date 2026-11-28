import type { Metadata } from "next";
import { AdvancePage } from "@/components/people/advance-page";

export const metadata: Metadata = {
  title: "Advances · ROP Workflow",
  description: "Advances paid to the person who holds them, aged from payment and settled with receipts by the deadline.",
};

export default function Page() {
  return <AdvancePage />;
}
