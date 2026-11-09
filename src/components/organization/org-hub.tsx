"use client";

import Link from "next/link";
import { useRequireUser } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";
import { holdsType } from "@/lib/authority";
import { orgAreasFor } from "@/lib/org-areas";

/** Running Roots of Peace: the parts this person's role opens, one card each. */
export function OrgHub() {
  const { user } = useRequireUser();
  if (!user) return null;
  const areas = orgAreasFor(user, (r) => holdsType(user.id, r));
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Organization</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Running Roots of Peace: people, pay, purchasing and the organization&rsquo;s rules. Each part opens only for the roles that need it, and every change is recorded in the audit log.</p>
        {areas.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Your role does not open any part of the Organization area.</p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {areas.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="block h-full rounded-2xl border border-line bg-surface p-4 transition hover:border-forest">
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-1 text-sm text-muted">{a.help}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
