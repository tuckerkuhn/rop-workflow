import type { Metadata } from "next";
import { FeedbackPage } from "@/components/progress/feedback-page";

export const metadata: Metadata = {
  title: "Feedback and complaints · ROP Workflow",
  description: "What farmers, community members, suppliers and staff told the project, and what the project answered.",
};

export default function Page() {
  return <FeedbackPage />;
}
