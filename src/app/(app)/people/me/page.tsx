import type { Metadata } from "next";
import { MyDetailsPage } from "@/components/people/people-page";

export const metadata: Metadata = { title: "My details · ROP Workflow", description: "Your own HR record; update your phone and emergency contact." };

export default function Page() {
  return <MyDetailsPage />;
}
