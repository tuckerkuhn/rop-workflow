import type { Metadata } from "next";
import { PeopleAdminPage } from "@/components/settings/people-admin-page";

export const metadata: Metadata = {
  title: "People and roles · ROP Workflow",
  description: "Who can sign in and what each person may do.",
};

export default function Page() {
  return <PeopleAdminPage />;
}
