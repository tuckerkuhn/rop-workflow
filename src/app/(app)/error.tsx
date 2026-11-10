"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/components/app/i18n";

/**
 * What any signed-in page shows when it fails to draw: what happened in plain words, that saved
 * work is safe, and two ways on. Without this file a failure was a blank page.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold text-ink">{t("err.title")}</h1>
      <p className="mt-3 text-base text-muted">{t("err.body")}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="min-h-12 rounded-xl bg-forest px-5 font-semibold text-forest-ink">
          {t("err.retry")}
        </button>
        <Link href="/home" className="inline-flex min-h-12 items-center rounded-xl border border-line px-5 font-semibold text-forest">
          {t("err.home")}
        </Link>
      </div>
    </main>
  );
}
