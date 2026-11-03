import type { Metadata } from "next";
import { RecordsPage } from "@/components/project/records-page";

export const metadata: Metadata = {
  title: "Project records · ROP Workflow",
};

export default function Page() {
  return <RecordsPage />;
}
