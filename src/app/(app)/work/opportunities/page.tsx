import type { Metadata } from "next";
import { OpportunitiesPage } from "@/components/work/opportunities-page";

export const metadata: Metadata = { title: "Opportunities · ROP Workflow", description: "Develop: opportunities, match briefs and match calls." };

export default function Page() {
  return <OpportunitiesPage />;
}
