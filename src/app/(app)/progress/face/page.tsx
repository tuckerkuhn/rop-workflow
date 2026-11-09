import type { Metadata } from "next";
import { FacePage } from "@/components/progress/face-page";

export const metadata: Metadata = { title: "FACE form · ROP Workflow", description: "UNDP's Funding Authorization and Certificate of Expenditures, from Finance's workbook." };

export default function Page() {
  return <FacePage />;
}
