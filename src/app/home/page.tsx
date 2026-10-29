import type { Metadata } from "next";
import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = {
  title: "Your dashboard · ROP Workflow",
};

export default function HomePage() {
  return <Dashboard />;
}
