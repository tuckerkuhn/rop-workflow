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
export const overlap = (win: MarketWindow) => win.months.filter((m) => HARVEST[win.crop].months.includes(m));

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
export const VALIDATION_ITEMS: { id: string; label: string; hint: (w: MarketWindow) => string }[] = [
  {
    id: "harvest",
    label: "Harvest months confirmed for the production area",
    hint: (w) => `Seed says ${monthsLabel(HARVEST[w.crop].months)}: ${HARVEST[w.crop].note} Confirm with traders or partner records for the project's provinces.`,
  },
  {
    id: "route",
    label: "Export route priced, avoiding closed borders",
    hint: (w) => `Price the route to ${w.market} that avoids the Pakistan border (air, or overland via Iran or Central Asia) for the open months.`,
  },
  {
    id: "buyer",
    label: "Buyer interest confirmed",
    hint: (w) => `At least one named importer in ${w.market} willing to buy in ${monthsLabel(w.months)}. ROP buyer contacts or trade show leads.`,
  },
  {
    id: "quality",
    label: "Required quality grade achievable",
    hint: (w) => `Check the grade the market expects against what producers delivered last season. Quality note: ${w.quality}`,
  },
];

/** Fit order for exploring: open and in harvest first, then open needing storage, policy, closed, not assessed. */
export function fitRank(w: MarketWindow) {
  if (w.status === "open") return overlap(w).length ? 0 : 1;
  return { policy: 2, closed: 3, unknown: 4, open: 0 }[w.status];
}
export const fitLabel = ["Open, overlaps harvest", "Open, needs storage", "Policy window", "Closed", "Not assessed"];
