"use client";

import { useRequireUser } from "@/components/app/session";
import { TopBar } from "@/components/workspace/ui";
import { Empty, LedgerRow, LedgerTable, PageHead } from "@/components/workspace/ledger";
import { holdsType } from "@/lib/authority";
import { orgAreasFor } from "@/lib/org-areas";

const COLS = "1fr";

/** Running Roots of Peace: the parts this person's role opens, one ruled row each. */
export function OrgHub() {
  const { user } = useRequireUser();
  if (!user) return null;
  const areas = orgAreasFor(user, (r) => holdsType(user.id, r));
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {/* The line says only what this person can open: someone with Resources alone is not promised pay and purchasing. */}
        <PageHead title="Organization" meta={areas.length ? `${areas.length} ${areas.length === 1 ? "area" : "areas"}` : undefined}>
          {areas.some((x) => x.id !== "resources") ? "The parts of Roots of Peace your role opens. Every change is recorded in the audit log." : "What Roots of Peace keeps for all staff."}
        </PageHead>
        {areas.length === 0 ? (
          <Empty className="mt-6">Your role does not open any part of the Organization area.</Empty>
        ) : (
          <LedgerTable cols={COLS} head={["Area"]} label="Organization areas" className="mt-6">
            {areas.map((a) => (
              <LedgerRow key={a.id} cols={COLS} href={a.href}>
                <span className="min-w-0">
                  <span className="block font-bold text-ink">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{a.help}</span>
                </span>
              </LedgerRow>
            ))}
          </LedgerTable>
        )}
      </main>
    </div>
  );
}
