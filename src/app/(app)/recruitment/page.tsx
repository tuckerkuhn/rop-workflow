import type { Metadata } from "next";
import { RecruitmentPage } from "@/components/people/recruitment-page";

export const metadata: Metadata = {
  title: "Recruitment · ROP Workflow",
  description: "Vacancies open at least 14 days, every CV graded, a panel at or above the post's grade, references for finalists, a selection memo.",
};

export default function Page() {
  return <RecruitmentPage />;
}
