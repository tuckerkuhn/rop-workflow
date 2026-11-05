import type { Metadata } from "next";
import { PolicyPage } from "@/components/settings/policy-page";

export const metadata: Metadata = {
  title: "Project rules · ROP Workflow",
  description: "The organization's policy combined with the donor's, with conflicts decided by an administrator.",
};

export default function Page() {
  return <PolicyPage />;
}
