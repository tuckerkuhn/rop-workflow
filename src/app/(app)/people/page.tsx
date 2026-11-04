import type { Metadata } from "next";
import { PeoplePage } from "@/components/people/people-page";

export const metadata: Metadata = {
  title: "People · ROP Workflow",
  description: "The HR record: every change proposed, signed and sealed; nothing edited or deleted.",
};

export default function Page() {
  return <PeoplePage />;
}
