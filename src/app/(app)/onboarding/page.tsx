import type { Metadata } from "next";
import { OnboardingPage } from "@/components/people/onboarding-page";

export const metadata: Metadata = {
  title: "Onboarding · ROP Workflow",
  description: "A new hire's first steps: details, policies, contract and ID, with HR's and the supervisor's parts.",
};

export default function Page() {
  return <OnboardingPage />;
}
