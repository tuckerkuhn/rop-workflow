import { z } from "zod";

/**
 * The parts of the app a project may not need. A first grant rarely gives grants of its own or
 * targets a market window, so each part can be switched off for a project and its pages leave the
 * menus. Nothing is deleted: switching a part back on shows everything it held. A project that has
 * never set them has every part on, as before. Kept in project state (key "modules").
 */

export const MODULES = [
  { id: "grants", label: "Grants to businesses or groups", help: "The project gives grants of its own (matching grants, sub-grants) and follows a grants manual. Shows Grants under Work." },
  { id: "market", label: "Market window design", help: "The project is built around selling a crop in a chosen market window. Shows Market windows under Set up." },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
export type Modules = Record<ModuleId, boolean>;
export const ALL_MODULES: Modules = { grants: true, market: true };
export const modulesSchema = z.object({ grants: z.boolean(), market: z.boolean() });
/** A change: only the parts switched, so one person's switch never undoes another's. */
export const modulesChangeSchema = modulesSchema.partial().refine((m) => Object.keys(m).length > 0, "Switch at least one part.");

/** The page each part adds to the menus. */
export const MODULE_HREF: Record<ModuleId, string> = { grants: "/work/grants", market: "/design" };

/** Whether a menu entry stays, given the project's parts. */
export const placeAllowed = (href: string, m: Modules) => !(Object.keys(MODULE_HREF) as ModuleId[]).some((id) => !m[id] && (href === MODULE_HREF[id] || href.startsWith(`${MODULE_HREF[id]}?`) || href.startsWith(`${MODULE_HREF[id]}/`)));
