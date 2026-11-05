import type { Metadata } from "next";
import { LeavePage } from "@/components/people/leave-page";

export const metadata: Metadata = {
  title: "Leave · ROP Workflow",
  description: "Leave requests and balances under ROP's personnel policies, approved by the supervisor and recorded in the HR record.",
};

export default function Page() {
  return <LeavePage />;
}
