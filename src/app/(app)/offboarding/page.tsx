import type { Metadata } from "next";
import { OffboardingPage } from "@/components/people/offboarding-page";

export const metadata: Metadata = { title: "Leaving and renewals · ROP Workflow", description: "Checklists for people leaving, and contracts ending soon." };

export default function Page() {
  return <OffboardingPage />;
}
