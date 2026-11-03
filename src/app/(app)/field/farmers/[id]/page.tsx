import type { Metadata } from "next";
import { FarmerProfile } from "@/components/field/profile";

export const metadata: Metadata = {
  title: "Farmer profile · ROP Workflow",
};

export default async function FarmerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerProfile id={id} />;
}
