"use client";

import { useSession } from "@/components/app/session";
import { ANY_LINK_CAUTION } from "@/lib/file-store";

/**
 * Under a link box while the organization takes "any secure link": the person pasting the link is
 * the one who decides where the proof sits, so the caution is said to them, not only to the
 * administrator who chose the setting. Shows nothing for an organization that names its file store.
 */
export function AnyLinkCaution() {
  const { fileStores } = useSession();
  if (!fileStores.now.includes("any")) return null;
  return (
    <p role="note" className="mt-1 border-s-[6px] border-clay ps-2 text-xs text-clay">
      {ANY_LINK_CAUTION}
    </p>
  );
}
