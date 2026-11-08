import type { Metadata } from "next";
import { MyDetailsPage } from "@/components/people/people-page";

export const metadata: Metadata = { title: "My details · ROP Workflow", description: "Your own HR record, read-only." };

export default function Page() {
  return <MyDetailsPage />;
}
