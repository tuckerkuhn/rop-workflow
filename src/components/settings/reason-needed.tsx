"use client";

/**
 * Said next to a Save (or Turn on, Layer on, Remove) button that stays greyed out until a reason
 * is written, so nobody is left wondering why it does not work. Shown only while the reason is
 * still too short (the server asks for 5 characters or more).
 */
export const REASON_MIN = 5;
export const reasonMissing = (reason: string) => reason.trim().length < REASON_MIN;

export function ReasonNeeded({ reason, to = "save", id, className = "" }: { reason: string; to?: string; id?: string; className?: string }) {
  if (!reasonMissing(reason)) return null;
  return (
    <p id={id} className={`text-xs text-warn ${className}`}>
      Add a short reason to {to}; it is kept in the log.
    </p>
  );
}
