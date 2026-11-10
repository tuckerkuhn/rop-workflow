"use client";

import { useId, useState } from "react";
import { useT } from "@/components/app/i18n";
import { FIELD_HELP, type FieldHelpEntry, type FieldHelpKey } from "@/lib/field-help";

/**
 * The small "?" after a field that collects personal or sensitive data: why we ask, how we
 * protect it, and where the requirement comes from. One component for every such field; the
 * words come from the register in lib/field-help.ts.
 */
export function FieldHelp({ field }: { field: FieldHelpKey }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const e: FieldHelpEntry = FIELD_HELP[field];
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("fh.open", { field: t(e.field) })}
        onClick={(ev) => {
          // Inside a <label>, a tap must not also focus the field.
          ev.preventDefault();
          setOpen(!open);
        }}
        className="ms-1 inline-flex h-11 w-11 items-center justify-center align-middle sm:h-7 sm:w-7"
      >
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-xs font-semibold text-muted">
          ?
        </span>
      </button>
      {open && (
        <span id={id} className="mt-1 block rounded-xl bg-mist px-3 py-2 text-xs font-normal text-ink">
          <span className="block">
            <span className="font-semibold">{t("fh.why")}</span> {t(e.why)}
          </span>
          {e.protect && (
            <span className="mt-1 block">
              <span className="font-semibold">{t("fh.protect")}</span> {t(e.protect)}
            </span>
          )}
          {e.source && (
            <span className="mt-1 block">
              <span className="font-semibold">{t("fh.source")}</span> {t(e.source)}
            </span>
          )}
        </span>
      )}
    </>
  );
}
