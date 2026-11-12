import type { Metadata } from "next";
import { GrantsPage } from "@/components/work/grants-page";

export const metadata: Metadata = { title: "Grants · ROP Workflow", description: "Agribusiness grants, step by step through the grants manual." };

export default function Page() {
  return <GrantsPage />;
}
