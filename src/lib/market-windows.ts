/**
 * Market windows: where import markets have unmet demand, and when.
 * Seed data for Afghanistan from the pilot section of "Harness Feature Brief: Market Windows".
 * Everything here is SAMPLE, UNVERIFIED. Where the brief gives no figure, the record says so
 * instead of guessing, and carries no source.
 */

export type Crop = "Grapes" | "Pomegranates" | "Onions";
export type Market = "India" | "UAE" | "Pakistan" | "Türkiye" | "Central Asia";
/** open: a window with months · closed: trade blocked · policy: opens on supply shocks, no fixed months · unknown: not assessed yet */
export type WindowStatus = "open" | "closed" | "policy" | "unknown";
export type Source = { label: string; url: string };

export type MarketWindow = {
  id: string;
  crop: Crop;
  origin: "Afghanistan";
  market: Market;
  status: WindowStatus;
  /** Months open, 1 = January. */
  months: number[];
  quality: string;
  price: string;
  sources: Source[];
};

export const CROPS: Crop[] = ["Grapes", "Pomegranates", "Onions"];
export const MARKETS: Market[] = ["India", "UAE", "Pakistan", "Türkiye", "Central Asia"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Latest dated source in the seed. */
export const DATA_AS_OF = "2026-08-19";
export const SAMPLE_LABEL = "Sample, unverified";

const S = {
  ap: { label: "AP via US News, Aug 2026", url: "https://www.usnews.com/news/business/articles/2026-08-19/afghan-farmers-turn-their-grapes-into-raisins-after-border-closures-slash-fruit-exports-to-pakistan" },
  freshplaza: { label: "FreshPlaza", url: "https://www.freshplaza.com/north-america/article/9840731/the-middle-east-continues-to-be-the-strongest-market-for-indian-pomegranates/" },
  tradologie: { label: "Tradologie", url: "https://www.tradologie.com/blogs/grapes-export-from-india/" },
  cbi: { label: "CBI", url: "https://www.cbi.eu/market-information/fresh-fruit-vegetables/pomegranates/europe" },
  vgf: { label: "VGF Global", url: "https://www.vgfglobal.com/blog/indian-fruit-export-season-calendar" },
  tridgeRaisins: { label: "Tridge", url: "https://www.tridge.com/market-overview/raisins/AF" },
  xinhua: { label: "Xinhua, Jan 2026", url: "https://english.news.cn/20260126/b5ad0f11e034455da198364a1a955474/c.html" },
  tridgeOnion: { label: "Tridge", url: "https://www.tridge.com/intelligences/onion/AF/export" },
} satisfies Record<string, Source>;

/** Afghan harvest per crop. The brief gives seasons, not months; month ranges are an interpretation to confirm by province. */
export const HARVEST: Record<Crop, { months: number[]; note: string; sources: Source[] }> = {
  Grapes: { months: [8, 9, 10], note: "Late summer and autumn (brief). Months to confirm by province.", sources: [S.ap, S.tradologie] },
  Pomegranates: { months: [9, 10, 11], note: "Autumn (brief). Months to confirm by province.", sources: [S.cbi, S.vgf] },
  Onions: { months: [6, 7, 8, 9], note: "Assumption, to verify. The brief gives no onion harvest months.", sources: [] },
};

const TO_VERIFY = "Not assessed yet. Listed in the brief as a market to test; no seasonality or price data in the seed.";

const w = (crop: Crop, market: Market, status: WindowStatus, months: number[], quality: string, price: string, sources: Source[]): MarketWindow => ({
  id: `${crop.slice(0, 3).toUpperCase()}-${market.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}`,
  crop,
  origin: "Afghanistan",
  market,
  status,
  months,
  quality,
  price,
  sources,
});

export const WINDOWS: MarketWindow[] = [
  // Grapes: the strongest first window.
  w(
    "Grapes",
    "India",
    "open",
    [6, 7, 8, 9, 10, 11],
    "India's own harvest runs December to April, so Afghan late-summer and autumn fruit lands in India's off-season. Fresh table grapes need a cold chain.",
    "Indian grape prices ran 15 to 20% higher this season on a short crop.",
    [S.tradologie, S.freshplaza],
  ),
  w("Grapes", "UAE", "unknown", [], TO_VERIFY, "No price data in the seed.", []),
  w(
    "Grapes",
    "Pakistan",
    "closed",
    [],
    "Historically the main buyer. Border closures cut Afghan fresh grape exports from about 43,000 tons to 256 tons so far in 2026; farmers are drying grapes into raisins instead.",
    "Not tradeable while the border is closed.",
    [S.ap],
  ),
  w("Grapes", "Türkiye", "unknown", [], TO_VERIFY, "No price data in the seed.", [S.xinhua]),
  w("Grapes", "Central Asia", "unknown", [], TO_VERIFY, "No price data in the seed.", [S.xinhua]),

  // Pomegranates: possible, but the gaps fall outside the Afghan harvest, so storage is needed.
  w(
    "Pomegranates",
    "India",
    "open",
    [2, 3, 7, 8],
    "India has months when high-quality fruit is hard to source. Afghanistan's autumn harvest collides with India's peak export season (October to February).",
    "No price figures in the brief.",
    [S.cbi, S.vgf],
  ),
  w(
    "Pomegranates",
    "UAE",
    "open",
    [2, 3, 7, 8],
    "The UAE is India's top buyer; supply gaps appear around February to March and July to August. Hitting them from an autumn harvest needs cold storage.",
    "No price figures in the brief.",
    [S.freshplaza, S.vgf],
  ),
  w("Pomegranates", "Pakistan", "unknown", [], TO_VERIFY, "No price data in the seed.", []),
  w("Pomegranates", "Türkiye", "unknown", [], TO_VERIFY, "No price data in the seed.", []),
  w("Pomegranates", "Central Asia", "unknown", [], TO_VERIFY, "No price data in the seed.", []),

  // Onions: a policy window. Afghanistan already sells to Pakistan, India, Turkmenistan and Türkiye.
  ...(["India", "Pakistan", "Türkiye", "Central Asia"] as Market[]).map((m) =>
    w(
      "Onions",
      m,
      "policy",
      [],
      `Existing Afghan export market${m === "Central Asia" ? " (Turkmenistan)" : ""}. Gaps open whenever a big exporter restricts supply, for example India's onion export ban from December 2023 to March 2024.`,
      "Prices spike during restrictions; no figures in the seed.",
      [S.tridgeOnion],
    ),
  ),
  w("Onions", "UAE", "unknown", [], TO_VERIFY, "No price data in the seed.", []),
];

export const windowById = (id: string) => WINDOWS.find((x) => x.id === id);
export const windowsFor = (crop: Crop) => MARKETS.map((m) => WINDOWS.find((x) => x.crop === crop && x.market === m)!).filter(Boolean);
/** Months where the window is open and the given harvest (default: all Afghanistan) is in. */
export const overlap = (win: MarketWindow, harvest: number[] = HARVEST[win.crop].months) => win.months.filter((m) => harvest.includes(m));

/** "Jun–Nov", "Feb–Mar, Jul–Aug", "Dec–Mar". */
export function monthsLabel(months: number[]) {
  if (!months.length) return "No fixed months";
  const set = new Set(months);
  const runs: number[][] = [];
  // Start each run at a month whose previous month is not open, so Dec–Mar stays one run.
  for (let m = 1; m <= 12; m++) {
    if (!set.has(m) || set.has(m === 1 ? 12 : m - 1)) continue;
    const run = [m];
    let next = (m % 12) + 1;
    while (set.has(next) && run.length < 12) {
      run.push(next);
      next = (next % 12) + 1;
    }
    runs.push(run);
  }
  if (!runs.length) runs.push([...months].sort((a, b) => a - b));
  return runs.map((r) => (r.length === 1 ? MONTHS[r[0] - 1] : `${MONTHS[r[0] - 1]}–${MONTHS[r[r.length - 1] - 1]}`)).join(", ");
}

export const targetLabel = (win: MarketWindow) => `${win.crop}, ${win.market}, ${monthsLabel(win.months)}`;

/* ---------- validation ---------- */

/**
 * What must be confirmed before a window counts as validated. Drawn from the brief's next steps.
 * Each item needs a named person and evidence; AI may only suggest where to look.
 */
export const VALIDATION_ITEMS: { id: string; label: (area: string) => string; hint: (w: MarketWindow, area: Area) => string }[] = [
  {
    id: "harvest",
    label: (area) => `Harvest months confirmed for ${area}`,
    hint: (_w, a) => `Calendar says ${monthsLabel(a.months)} for ${a.name}: ${a.note} Confirm with traders or partner records from that area.`,
  },
  {
    id: "route",
    label: () => "Export route priced, avoiding closed borders",
    hint: (w) => `Price the route to ${w.market} that avoids the Pakistan border (air, or overland via Iran or Central Asia) for the open months.`,
  },
  {
    id: "buyer",
    label: () => "Buyer interest confirmed",
    hint: (w) => `At least one named importer in ${w.market} willing to buy in ${monthsLabel(w.months)}. ROP buyer contacts or trade show leads.`,
  },
  {
    id: "quality",
    label: () => "Required quality grade achievable",
    hint: (w) => `Check the grade the market expects against what producers delivered last season. Quality note: ${w.quality}`,
  },
];

/** Fit order for exploring: open and in harvest first, then open needing storage, policy, closed, not assessed. */
export function fitRank(w: MarketWindow, harvest?: number[]) {
  if (w.status === "open") return overlap(w, harvest).length ? 0 : 1;
  return { policy: 2, closed: 3, unknown: 4, open: 0 }[w.status];
}
export const fitLabel = ["Open, overlaps harvest", "Open, needs storage", "Policy window", "Closed", "Not assessed"];

/* ---------- production areas and competing supply ---------- */

/**
 * ROP's own layer: when production comes to market from each Afghan area, and from competing origins.
 * Only India's seasons come from the brief. Every other month range is an ASSUMPTION TO VERIFY,
 * seeded from general knowledge so the team can correct it in the app.
 */
const ASSUMED = "Assumption, to verify (not from the brief).";
export const ALL_AREA = "all";

export type Area = { id: string; crop: Crop; name: string; months: number[]; note: string; sources: Source[] };
/** One competing origin in one import market: when it supplies that market and how it competes with Afghan produce there. */
export type Competitor = { id: string; crop: Crop; market: Market; origin: string; months: number[]; note: string; sources: Source[] };
export type CalendarEdit = { rowId: string; by: string; date: string; note: string };
export type CalendarData = { areas: Area[]; competitors: Competitor[]; edits: CalendarEdit[] };

export function seedCalendar(): CalendarData {
  const a = (crop: Crop, id: string, name: string, months: number[]): Area => ({ id: `${crop.slice(0, 3).toUpperCase()}-${id}`, crop, name, months, note: ASSUMED, sources: [] });
  const c = (crop: Crop, market: Market, origin: string, months: number[], note: string, sources: Source[] = []): Competitor => ({
    id: `${crop.slice(0, 3).toUpperCase()}-${market.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${origin.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}`,
    crop,
    market,
    origin,
    months,
    note: sources.length ? note : `${note} ${ASSUMED}`,
    sources,
  });
  return {
    areas: [
      a("Grapes", "kandahar", "Kandahar", [6, 7, 8]),
      a("Grapes", "kabul", "Kabul (Shomali plain)", [8, 9, 10]),
      a("Grapes", "herat", "Herat", [7, 8, 9]),
      a("Pomegranates", "kandahar", "Kandahar", [9, 10, 11]),
      a("Pomegranates", "balkh", "Balkh", [9, 10]),
      a("Onions", "kandahar", "Kandahar", [4, 5, 6]),
      a("Onions", "herat", "Herat", [6, 7, 8]),
      a("Onions", "balkh", "Balkh", [7, 8, 9]),
    ],
    competitors: [
      // Grapes
      c("Grapes", "India", "India (domestic crop)", [12, 1, 2, 3, 4], "India's own harvest runs December to April (brief), so it is off-season to Afghan summer and autumn fruit and does not compete with it.", [S.tradologie]),
      c("Grapes", "India", "Iran", [7, 8, 9, 10], "Ships by sea to western India in the same months as the Afghan harvest; competes on price."),
      c("Grapes", "India", "Uzbekistan", [8, 9, 10], "Small air-freighted volumes of premium varieties; overlaps Afghan Aug–Oct fruit at the top of the market."),
      c("Grapes", "India", "Southern Hemisphere (Chile, South Africa)", [1, 2, 3, 4], "Fills India's import needs early in the year, outside the Afghan window."),
      c("Grapes", "UAE", "Iran", [7, 8, 9, 10], "Short sea route makes Iranian grapes the cheapest summer supply in Dubai; the main price competitor."),
      c("Grapes", "UAE", "Türkiye", [7, 8, 9, 10], "Established with Gulf retailers; competes on consistent grading and packing rather than price."),
      c("Grapes", "UAE", "India", [2, 3, 4], "Indian export grapes reach the Gulf late winter and spring, after the Afghan season."),
      c("Grapes", "Türkiye", "Türkiye (domestic crop)", [7, 8, 9, 10], "Large home crop in the same months; Afghan fruit could only compete on early or late varieties."),
      c("Grapes", "Central Asia", "Uzbekistan", [8, 9, 10], "The main regional supplier, close to buyers; competes directly on freight cost."),
      c("Grapes", "Central Asia", "Iran", [7, 8, 9, 10], "Supplies Turkmenistan overland; overlaps Afghan fruit."),
      // Pomegranates
      c("Pomegranates", "India", "India (domestic crop)", [10, 11, 12, 1, 2], "India's peak season; Afghan autumn fruit collides with it (brief).", [S.vgf]),
      c("Pomegranates", "UAE", "India", [10, 11, 12, 1, 2], "The UAE is India's top pomegranate buyer; heavy Indian supply October to February (brief).", [S.freshplaza]),
      c("Pomegranates", "UAE", "Iran", [10, 11, 12], "Short sea route; competes with Afghan fruit on price in the same autumn months."),
      c("Pomegranates", "UAE", "Türkiye", [9, 10, 11, 12], "Sold through Gulf retailers; competes on presentation and shelf life."),
      c("Pomegranates", "Türkiye", "Türkiye (domestic crop)", [9, 10, 11, 12], "Large home crop in the same months as the Afghan harvest."),
      c("Pomegranates", "Central Asia", "Iran", [10, 11, 12], "Supplies Turkmenistan overland in the same months as Afghan fruit."),
      // Onions
      c("Onions", "India", "India (domestic crops)", [3, 4, 5, 10, 11, 12], "India's own rabi and kharif crops; Afghan onions only sell when Indian supply is short."),
      c("Onions", "UAE", "India", [3, 4, 5, 10, 11, 12], "The usual supplier; gaps open when India restricts exports, as in its ban from December 2023 to March 2024 (brief)."),
      c("Onions", "UAE", "Iran", [6, 7, 8, 9], "Summer supply by sea; competes with Afghan onions in the same months."),
      c("Onions", "Pakistan", "Pakistan (domestic crop)", [1, 2, 3, 4], "Pakistan's own crop early in the year; Afghan onions fill the gap after it."),
      c("Onions", "Central Asia", "Iran", [6, 7, 8, 9], "Overland to Turkmenistan; overlaps Afghan summer onions."),
      c("Onions", "Central Asia", "Pakistan", [1, 2, 3, 4], "Ships north early in the year, before the Afghan crop."),
      c("Onions", "Türkiye", "Türkiye (domestic crop)", [6, 7, 8, 9], "Large home crop; Afghan onions only compete when Turkish supply is short."),
    ],
    edits: [],
  };
}

/** Every province's harvest for a crop, plus the brief's national band, combined. */
export function nationalArea(crop: Crop, cal?: CalendarData): Area {
  const months = [...new Set([...HARVEST[crop].months, ...(cal?.areas.filter((a) => a.crop === crop).flatMap((a) => a.months) ?? [])])].sort((a, b) => a - b);
  return { id: ALL_AREA, crop, name: "All Afghanistan", months, note: `Every production area combined, plus the brief's national band (${monthsLabel(HARVEST[crop].months)}).`, sources: HARVEST[crop].sources };
}
export const provincesFor = (cal: CalendarData, crop: Crop) => cal.areas.filter((a) => a.crop === crop);
export const areasFor = (cal: CalendarData, crop: Crop) => [nationalArea(crop, cal), ...provincesFor(cal, crop)];
export const areaFor = (cal: CalendarData, crop: Crop, id?: string) => areasFor(cal, crop).find((a) => a.id === id) ?? nationalArea(crop, cal);
export const competitorsIn = (cal: CalendarData, crop: Crop, market: Market) => cal.competitors.filter((c) => c.crop === crop && c.market === market);

/** Months we would be selling into this window: the harvest overlap, or the whole window if produce is stored to reach it. */
export const supplyMonths = (win: MarketWindow, harvest: number[]) => {
  const ov = overlap(win, harvest);
  return ov.length ? ov : win.months;
};

/** Competing origins supplying this market during the months we would sell into it. */
export function competition(win: MarketWindow, harvest: number[], cal: CalendarData) {
  const ours = supplyMonths(win, harvest);
  return competitorsIn(cal, win.crop, win.market)
    .map((c) => ({ origin: c.origin, months: c.months.filter((m) => ours.includes(m)) }))
    .filter((c) => c.months.length > 0);
}
