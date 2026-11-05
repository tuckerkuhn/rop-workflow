import type { Metadata } from "next";
import { OrgSettingsPage } from "@/components/settings/org-settings-page";

export const metadata: Metadata = {
  title: "Organization settings · ROP Workflow",
  description: "The rules the whole organization works by, by department, with presets and every change recorded.",
};

export default function Page() {
  return <OrgSettingsPage />;
}
