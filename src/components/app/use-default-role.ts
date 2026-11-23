"use client";

import { useState } from "react";

/**
 * The role a workflow queue opens on: the first of the person's roles with something waiting,
 * else their first role. It is chosen once, when the counts first load for this project, and
 * kept after that, so the view does not jump as items move between roles. A tab the person picks
 * wins over it.
 */
export function useDefaultRole<R extends string>(myRoles: readonly R[], counts: Record<string, number>, loaded: boolean, project: string, picked: R | null): R | null {
  const [chosen, setChosen] = useState<{ project: string; role: R | null } | null>(null);
  if (loaded && chosen?.project !== project) setChosen({ project, role: myRoles.find((r) => (counts[r] ?? 0) > 0) ?? myRoles[0] ?? null });
  if (picked && myRoles.includes(picked)) return picked;
  const first = chosen?.project === project ? chosen.role : null;
  return first && myRoles.includes(first) ? first : (myRoles[0] ?? null);
}
