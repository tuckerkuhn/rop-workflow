/** English: the source strings. Every other language falls back to these. */
export const en = {
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.tasks": "Tasks",
  "nav.progress": "Progress",
  "nav.resources": "Resources",

  "project.label": "Project",

  "menu.language": "Language",
  "menu.untranslated": "Some screens are still in English.",
  "menu.about": "About this prototype",
  "menu.viewAs": "View as (read-only)",
  "menu.myself": "Myself ({name})",
  "menu.signOut": "Sign out",
  "banner.viewingAs": "Viewing as {name}, read-only. Farmer names follow your own access, {actor}.",
  "banner.back": "Back to my view",

  "tasks.title": "Tasks",
  "tasks.source": "Work type",
  "tasks.field": "Field activities",
  "tasks.procurement": "Procurement",
  "tasks.noWork": "{project} has no field or procurement work yet.",
  "tasks.noAccess": "Your role does not include field or procurement work.",

  "resources.title": "Resources",
  "resources.intro": "Guides, templates and checks for designing and running a project.",
  "resources.soon": "Coming soon",
  "resources.craft": "The Craft guides",
  "resources.templates": "Templates",
  "resources.viability": "Viability check",
  "resources.dirtyDozen": "The Dirty Dozen",

  "design.staffOnly": "Project design is for Roots of Peace staff.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
