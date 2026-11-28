import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormRunner } from "@/components/field/form-runner";
import { APP_FORM_TEXT, isAppFormKind } from "@/lib/app-forms";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  return { title: `${isAppFormKind(kind) ? APP_FORM_TEXT[kind].title : "Field form"} · ROP Workflow` };
}

/** One field form, filled in inside the app (components/field/form-runner). */
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isAppFormKind(kind)) notFound();
  return <FormRunner kind={kind} />;
}
