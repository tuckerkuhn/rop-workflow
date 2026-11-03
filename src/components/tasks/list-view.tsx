"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { RowItem, type RowActions } from "@/components/tasks/row";
import { SectionLabel } from "@/components/workspace/ui";
import { BUCKETS, bucketOf, type Bucket, type Row } from "@/lib/work-items";

/** Tasks and milestones grouped by when they are due. Done and past items start folded away. */
export function ListView({ rows, actions }: { rows: Row[]; actions: RowActions }) {
  const { t } = useT();
  const [showDone, setShowDone] = useState(false);
  const groups = BUCKETS.map((b) => ({ b, rows: rows.filter((r) => bucketOf(r) === b) })).filter((g) => g.rows.length);

  if (rows.length === 0) return <p className="py-16 text-center text-sm text-muted">{t("tasks.empty")}</p>;
  return (
    <div className="space-y-6">
      {groups.map(({ b, rows }) => {
        const folded = b === "done" && !showDone;
        return (
          <section key={b} aria-labelledby={`bucket-${b}`}>
            <div className="flex items-center justify-between border-b border-line pb-1.5">
              <span id={`bucket-${b}`} className={b === "overdue" ? "[&>h4]:text-clay" : ""}>
                <SectionLabel>
                  {t(`tasks.bucket.${b}` as `tasks.bucket.${Bucket}`)} · {rows.length}
                </SectionLabel>
              </span>
              {b === "done" && (
                <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} aria-controls={`list-${b}`} aria-label={t("tasks.bucket.done")} className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-muted hover:bg-sunken hover:text-ink">
                  {showDone ? "−" : "+"}
                </button>
              )}
            </div>
            {!folded && (
              <ul id={`list-${b}`} className="divide-y divide-line">
                {rows.map((r) => (
                  <RowItem key={r.key} row={r} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
