import type { Metadata } from "next";
import { PortfolioPage } from "@/components/home/portfolio-page";

export const metadata: Metadata = { title: "All projects · ROP Workflow", description: "Every project side by side: results against targets, then money against time." };

export default function Page() {
  return <PortfolioPage />;
}
