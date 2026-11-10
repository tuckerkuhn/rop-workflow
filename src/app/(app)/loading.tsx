"use client";

import { useT } from "@/components/app/i18n";

/** Shown while a signed-in page is on its way, so a slow connection never looks like a blank page. */
export default function AppLoading() {
  const { t } = useT();
  return (
    <main className="mx-auto max-w-6xl px-4 py-16" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-line" />
      <div className="mt-6 h-24 animate-pulse rounded-2xl bg-line/70" />
      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-line/50" />
      <span className="sr-only">{t("load.wait")}</span>
    </main>
  );
}
