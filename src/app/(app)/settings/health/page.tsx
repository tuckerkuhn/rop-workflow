import type { Metadata } from "next";
import { HealthPage } from "@/components/settings/health-page";

export const metadata: Metadata = { title: "System health and backups · ROP Workflow", description: "Server errors, AI use, email and the records export, for administrators." };

export default function Page() {
  return <HealthPage />;
}
