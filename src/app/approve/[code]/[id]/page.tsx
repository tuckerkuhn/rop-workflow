import type { Metadata } from "next";
import { ApprovePanel } from "@/components/approve/approve-panel";

/** An input distribution waiting for the project manager, opened from the email link or Home. */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve a distribution · ROP Workflow", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ code: string; id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { code, id } = await params;
  const { t } = await searchParams;
  return <ApprovePanel code={decodeURIComponent(code)} id={id} token={t ?? ""} />;
}
