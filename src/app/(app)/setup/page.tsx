import type { Metadata } from "next";
import { SetupPage } from "@/components/setup/setup-page";

export const metadata: Metadata = {
  title: "Project setup · ROP Workflow",
};

export default function Page() {
  return <SetupPage />;
}
