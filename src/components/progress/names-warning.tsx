"use client";

import { namesIn } from "@/lib/personal-text";

/** A gentle warning under a note that seems to name someone or their village. Never blocks saving. */
export function NamesWarning({ text }: { text: string }) {
  const found = namesIn(text);
  if (!found.length) return null;
  return (
    <p className="mt-1 text-xs text-ochre">
      This seems to name someone or their village ({found.slice(0, 3).join(", ")}). Use a first name only if they agreed to it, or a farmer code; the district goes in the place field. Notes are visible to all project staff.
    </p>
  );
}
