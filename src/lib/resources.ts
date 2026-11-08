/**
 * The resource library: ROP's own guides (kept in SharePoint, linked here), the Dirty Dozen in
 * brief, and the viability tests it sets. The documents are the authority; this is a way in.
 */

const sp = (path: string) => `https://rootsofpeace.sharepoint.com/${path.split("/").map(encodeURIComponent).join("/")}`;

export const GUIDES = [
  { title: "The Craft: How Roots of Peace Builds Agricultural Trade Systems", what: "The investment logic, methodology and operating disciplines behind three decades of ROP's work.", href: sp("corp/Branding/ROP Proof Points & Core Brand Docs/Library/ROP_The_Craft.pdf") },
  { title: "The Dirty Dozen of Development", what: "Twelve patterns that make agricultural development fail, and what ROP does instead (Gary Kuhn, June 2026).", href: sp("corp/Shared Documents/ARLP - Afghanistan Rural Livelihoods Program/06_ROP Internal/01_Governance and Policies/00_Foundation/The Dirty Dozen of Development_June_16_26.docx") },
  { title: "Brand Foundation, Book 3: Proof", what: "ROP's proof points: what the record shows, for funders and the board.", href: sp("corp/proc/ROP_Governance_Corpus_Package/00_Foundation/Book 3 - Proof.docx") },
  { title: "Brand Guidelines", what: "Logo, colour, type, imagery and voice.", href: sp("corp/Branding/ROP Proof Points & Core Brand Docs/Brand/ROP_Brand_Guidelines_v1.pdf") },
  { title: "Governance corpus: policies and manuals", what: "Procurement, finance, travel, grants and HR policies that the app's rules come from.", href: sp("corp/proc/ROP_Governance_Corpus_Package") },
];

export type Pattern = { n: number; group: "Wrong thinking" | "Wrong work" | "Wrong accountability"; name: string; looksLike: string; instead: string };
/** The twelve patterns, in brief. The document has the full text and the field examples. */
export const DIRTY_DOZEN: Pattern[] = [
  { n: 1, group: "Wrong thinking", name: "Aid in development clothing", looksLike: "Giveaways, per-diems and free inputs; farmers as recipients, not partners.", instead: "Farmer capital on every intervention, and no per-diems." },
  { n: 2, group: "Wrong thinking", name: "Misdirected expertise", looksLike: "Outsiders pushing their own idea; expats overriding local knowledge.", instead: "Local knowledge governs how; the investment logic governs what. Local staff first." },
  { n: 3, group: "Wrong thinking", name: "Chasing the new", looksLike: "Novel technology where a simple tool does more; strategy that follows funding fashion.", instead: "The highest-return fix for the binding constraint, usually the simplest." },
  { n: 4, group: "Wrong thinking", name: "Context blindness", looksLike: "A model lifted from elsewhere; equipment no one locally can run or repair.", instead: "Design for the crops, capacity and stage in front of you." },
  { n: 5, group: "Wrong work", name: "Disconnected design", looksLike: "Activities as a checklist that never become a working system.", instead: "Map the chain end to end, find the binding constraint, sequence everything to it." },
  { n: 6, group: "Wrong work", name: "Crops without markets", looksLike: "Production targets with no confirmed buyer and no pro forma.", instead: "Markets first: verified demand, volume, quality and price, a buyer before planting." },
  { n: 7, group: "Wrong work", name: "The food security trap", looksLike: "Smallholders steered into subsistence staples.", instead: "High-value crops with verified markets; food security through income." },
  { n: 8, group: "Wrong work", name: "Forgetting the agribusiness middle", looksLike: "Farmer-only programs with no traders, processors or exporters.", instead: "Build the midstream: every node is a market link and a source of jobs." },
  { n: 9, group: "Wrong accountability", name: "Competing agendas", looksLike: "Other agendas folded silently into economic work.", instead: "The work is economic; other agendas are named and kept in proportion." },
  { n: 10, group: "Wrong accountability", name: "Optics over outcomes", looksLike: "Glossy reports and outputs counted as results.", instead: "Measurable income change, held to the 50% net-income floor." },
  { n: 11, group: "Wrong accountability", name: "Dependency by design", looksLike: "Systems that need the implementer forever.", instead: "Exit designed in from day one: the chain must stand when ROP leaves." },
  { n: 12, group: "Wrong accountability", name: "Manager mode", looksLike: "Leadership at a distance; programs steered by spending and deliverables.", instead: "Leadership on the work; steer by a few verifiable impact numbers." },
];

/** The viability tests the Dirty Dozen sets for an intervention. */
export const VIABILITY_TESTS = [
  { id: "capital", label: "Farmers put their own money in", why: "Pattern 1: if nothing costs the farmer anything, nothing sticks." },
  { id: "buyer", label: "A buyer is verified (demand, volume, quality, price), with a commitment before planting where possible", why: "Pattern 6: markets first, not last." },
  { id: "proforma", label: "A pro forma profit analysis was run for the farmer", why: "Pattern 6: the named tell of a crop without a market." },
  { id: "constraint", label: "It fixes the binding constraint in the chain, with the other links in place or built in sync", why: "Patterns 3 and 5." },
  { id: "fit", label: "Local people can run and repair it, and it fits the crops and capacity there", why: "Pattern 4." },
  { id: "middle", label: "Traders, processors or exporters are part of the plan", why: "Pattern 8." },
  { id: "exit", label: "There is a plan for it to run without ROP", why: "Pattern 11." },
] as const;
/** The net-income floor: income from the intervention at least 50% above what the farmer earns now. */
export const NET_INCOME_FLOOR = 0.5;
