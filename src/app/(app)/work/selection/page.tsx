import type { Metadata } from "next";
import { SelectionPage } from "@/components/work/selection-page";

export const metadata: Metadata = {
  title: "Farmer selection · ROP Workflow",
  description: "The written rule for who takes part, and for each farmer the decision, the reason and who made it.",
};

export default function Page() {
  return <SelectionPage />;
}
