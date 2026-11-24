"use client";

/**
 * The last answer of Home's own reads (Home's data, the week ahead), kept in this tab's memory
 * only, so coming back to Home shows it at once while a fresh read runs behind it. Never written
 * to the browser's storage: a reload or a new tab starts empty.
 *
 * Kept per person: each answer is filed under who is signed in, whose screens are shown (they
 * differ under "View as") and the address read, and the whole store is dropped the moment the
 * signed-in person or the viewed person changes, at sign-out, and after Home changes anything.
 * A person never sees an answer read for someone else.
 */
const kept = new Map<string, unknown>();
let owner = "";
/** Plenty for a few projects and the week; the oldest goes first. */
const MAX = 24;

/** The person the store is for (`actorId|userId`): a different one empties it first. */
function ownedBy(who: string) {
  if (who !== owner) {
    kept.clear();
    owner = who;
  }
}

/** The key for one read: who reads it and the address. */
export const homeCacheKey = (actorId: string | null | undefined, userId: string, url: string) => `${actorId ?? userId}|${userId}|${url}`;
const whoOf = (key: string) => key.split("|").slice(0, 2).join("|");

/** The last answer kept for this key, or undefined. */
export function cachedHome<T>(key: string): T | undefined {
  ownedBy(whoOf(key));
  return kept.get(key) as T | undefined;
}

/** Keeps the latest answer for this key. */
export function keepHome(key: string, value: unknown) {
  ownedBy(whoOf(key));
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > MAX) kept.delete(kept.keys().next().value!);
}

/** Forgets every answer: at sign-out, when the person changes, and after Home changes anything. */
export function forgetHome() {
  kept.clear();
  owner = "";
}
