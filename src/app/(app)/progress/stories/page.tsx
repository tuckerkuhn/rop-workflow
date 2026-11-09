import type { Metadata } from "next";
import { StoriesPage } from "@/components/progress/stories-page";

export const metadata: Metadata = { title: "Success stories · ROP Workflow", description: "The people behind the figures, with their consent." };

export default function Page() {
  return <StoriesPage />;
}
