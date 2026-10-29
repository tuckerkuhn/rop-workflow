import type { Metadata } from "next";
import { SignIn } from "@/components/app/sign-in";

export const metadata: Metadata = {
  title: "Sign in · ROP Workflow",
  description: "Sign in to Roots of Peace Workflow: field activities, procurement, documents and approvals.",
};

export default function SignInPage() {
  return <SignIn />;
}
