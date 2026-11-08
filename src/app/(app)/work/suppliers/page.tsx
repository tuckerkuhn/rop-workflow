import type { Metadata } from "next";
import { SuppliersPage } from "@/components/procurement/suppliers-page";

export const metadata: Metadata = {
  title: "Suppliers · ROP Workflow",
  description: "The supplier register: licence, confirmed bank details, screenings and declarations for every supplier ROP buys from.",
};

export default function Page() {
  return <SuppliersPage />;
}
