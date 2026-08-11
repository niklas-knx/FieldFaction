// Server-side copy of merchant/product data for market matching.
// Must stay in sync with src/data/merchants.ts and src/data/products.ts.

// Units a merchant buys per 60-second matching round (per product)
export const MERCHANT_DEMAND: Record<string, Record<string, number>> = {
  grosshandel:    { default: 2000 },
  supermarkt:     { default: 500,  milk: 600, eggs: 800 },
  molkerei:       { default: 0,    milk: 1200, cheese: 300, butter: 600, eggs: 200 },
  fleischerei:    { default: 0,    pork: 600,  beef: 400,  chicken_meat: 400, sausage: 400, eggs: 300 },
  baeckerei:      { default: 0,    flour: 800, eggs: 400, milk: 300, wheat: 500 },
  getreideboerse: { default: 0,    wheat: 2000, corn: 1500, flour: 600, sunflower: 800, potato: 1000 },
  biomarkt:       { default: 300,  jam: 200, sunflower_oil: 200, butter: 300, cheese: 200 },
  feinkost:       { default: 0,    sausage: 200, cheese: 200, jam: 300, sunflower_oil: 200, butter: 200, egg_box: 300 },
  exporteur:      { default: 3000 },
  konserven:      { default: 0,    tomato: 1000, strawberry: 800, jam: 500, corn: 1200 },
};

// Price multipliers per merchant (merchant_price = base_price × multiplier)
export const MERCHANT_MULTS: Record<string, Record<string, number>> = {
  grosshandel:    { default: 0.85 },
  supermarkt:     { default: 1.00, eggs: 1.10, egg_box: 1.10 },
  molkerei:       { default: 0,    milk: 1.35, butter: 1.30, cheese: 1.45, eggs: 1.10 },
  fleischerei:    { default: 0,    pork: 1.40, beef: 1.35, chicken_meat: 1.30, sausage: 1.38, eggs: 1.15 },
  baeckerei:      { default: 0,    flour: 1.35, eggs: 1.20, milk: 1.10, wheat: 1.12 },
  getreideboerse: { default: 0,    wheat: 1.22, corn: 1.18, flour: 1.28, sunflower: 1.15, potato: 1.10 },
  biomarkt:       { default: 1.15, jam: 1.30, sunflower_oil: 1.25, butter: 1.22, cheese: 1.28 },
  feinkost:       { default: 0,    sausage: 1.48, cheese: 1.45, jam: 1.40, sunflower_oil: 1.35, butter: 1.30, egg_box: 1.32 },
  exporteur:      { default: 0.92 },
  konserven:      { default: 0,    tomato: 1.28, strawberry: 1.22, jam: 1.32, corn: 1.15 },
};

// Base sell prices per unit (€) — must match src/data/products.ts + src/data/crops.ts
export const BASE_PRICES: Record<string, number> = {
  wheat: 0.20, potato: 0.09, corn: 0.19, tomato: 0.55, sunflower: 0.38, strawberry: 1.80,
  milk: 0.46, eggs: 0.35, egg_box: 4.20, pork: 1.80, beef: 3.50, chicken_meat: 3.20, sausage: 5.50,
  flour: 0.90, cheese: 9.00, sunflower_oil: 3.20, butter: 7.00, jam: 2.80,
};

// ── Saisonalität ──────────────────────────────────────────────────────────────
// Gleiche Erntesaison-Logik wie die client-seitigen dynamischen Kurse (src/farm/Farm.ts,
// PRODUCT_SEASONALITY), aber am echten Kalenderjahr verankert statt am Spielstand-eigenen
// Ticks/Tagen: Kundenanfragen sind ein geteilter Server-Zustand (eine Anfrage-Liste pro
// Stadt für alle Spieler), es gibt also keinen einzelnen "Spielstand-Tag", an dem man sie
// ausrichten könnte. Reale Jahreszeiten sorgen wenigstens dafür, dass ein Winter-Angebot
// für Erdbeeren o.Ä. auch inhaltlich Sinn ergibt.
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
interface SeasonalityDef { peak: Season; amplitude: number; }

const PRODUCT_SEASONALITY: Record<string, SeasonalityDef> = {
  wheat:         { peak: 'summer', amplitude: 0.12 },
  potato:        { peak: 'autumn', amplitude: 0.12 },
  corn:          { peak: 'autumn', amplitude: 0.12 },
  tomato:        { peak: 'summer', amplitude: 0.12 },
  sunflower:     { peak: 'autumn', amplitude: 0.12 },
  strawberry:    { peak: 'spring', amplitude: 0.12 },
  milk:          { peak: 'spring', amplitude: 0.10 },
  eggs:          { peak: 'summer', amplitude: 0.10 },
  beef:          { peak: 'autumn', amplitude: 0.10 },
  flour:         { peak: 'summer', amplitude: 0.06 },
  cheese:        { peak: 'spring', amplitude: 0.06 },
  butter:        { peak: 'spring', amplitude: 0.06 },
  sausage:       { peak: 'autumn', amplitude: 0.06 },
  sunflower_oil: { peak: 'autumn', amplitude: 0.06 },
  jam:           { peak: 'spring', amplitude: 0.06 },
  egg_box:       { peak: 'summer', amplitude: 0.06 },
  // pork, chicken_meat: ganzjährige Stallproduktion → keine Saisonalität
};

// Ungefährer Tag-des-Jahres der Saisonmitte (meteorologische Jahreszeiten, Nordhalbkugel)
const SEASON_CENTER_DAY: Record<Season, number> = {
  winter: 14,   // Mitte Januar
  spring: 105,  // Mitte April
  summer: 197,  // Mitte Juli
  autumn: 288,  // Mitte Oktober
};

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

// Saisonaler Faktor als glatte Kosinuskurve übers (reale) Jahr: 1-amplitude in der
// Erntesaison, 1+amplitude ein halbes Jahr später — analog zur Client-Logik.
export function seasonalFactor(productId: string, date: Date = new Date()): number {
  const def = PRODUCT_SEASONALITY[productId];
  if (!def) return 1;
  let diff = Math.abs(dayOfYear(date) - SEASON_CENTER_DAY[def.peak]);
  if (diff > 365 / 2) diff = 365 - diff;
  const angle = (diff / (365 / 2)) * Math.PI;
  return 1 - def.amplitude * Math.cos(angle);
}

// Merchants available per city (keyed by city = farm meta id)
export const CITY_MERCHANTS: Record<string, string[]> = {
  muenchen:  ['molkerei',       'fleischerei',  'grosshandel'  ],
  nuernberg: ['getreideboerse', 'baeckerei',    'grosshandel'  ],
  stuttgart: ['biomarkt',       'konserven',    'supermarkt'   ],
  frankfurt: ['feinkost',       'exporteur',    'supermarkt'   ],
  leipzig:   ['getreideboerse', 'fleischerei',  'grosshandel'  ],
  koeln:     ['feinkost',       'supermarkt',   'exporteur'    ],
  hamburg:   ['exporteur',      'molkerei',     'grosshandel'  ],
  berlin:    ['biomarkt',       'feinkost',     'supermarkt'   ],
};

// ── Stadtprofile ──────────────────────────────────────────────────────────────

export interface CityProfile {
  priceMultiplier: number;     // Aufschlag/Abschlag auf max_price der Kundenanfragen
  requestsPerRound: number;    // Anfragen die pro 60s-Runde generiert werden
  quantityMultiplier: number;  // Skalierung der Bestellmengen
  label: string;               // Charakter-Beschreibung
  emoji: string;
}

export const CITY_PROFILES: Record<string, CityProfile> = {
  muenchen:  { priceMultiplier: 1.15, requestsPerRound: 3, quantityMultiplier: 1.0, label: 'Premiummarkt',          emoji: '🏔' },
  nuernberg: { priceMultiplier: 0.85, requestsPerRound: 4, quantityMultiplier: 1.3, label: 'Verarbeitungszentrum',  emoji: '⚙️' },
  stuttgart: { priceMultiplier: 1.18, requestsPerRound: 2, quantityMultiplier: 0.7, label: 'Bioregion',             emoji: '🌿' },
  frankfurt: { priceMultiplier: 1.20, requestsPerRound: 2, quantityMultiplier: 0.8, label: 'Finanzplatz',           emoji: '💼' },
  leipzig:   { priceMultiplier: 0.88, requestsPerRound: 4, quantityMultiplier: 1.3, label: 'Industriestadt',        emoji: '🏭' },
  koeln:     { priceMultiplier: 1.25, requestsPerRound: 2, quantityMultiplier: 0.6, label: 'Feinkostmetropole',     emoji: '🫙' },
  hamburg:   { priceMultiplier: 1.05, requestsPerRound: 4, quantityMultiplier: 1.5, label: 'Exporthafen',           emoji: '🚢' },
  berlin:    { priceMultiplier: 1.00, requestsPerRound: 3, quantityMultiplier: 1.0, label: 'Vielfalt',              emoji: '🏙' },
};

export function getMerchantPrice(merchantId: string, productId: string): number {
  const mults = MERCHANT_MULTS[merchantId];
  if (!mults) return 0;
  const mult = mults[productId] ?? mults.default ?? 0;
  if (mult <= 0) return 0;
  return (BASE_PRICES[productId] ?? 0) * mult * seasonalFactor(productId);
}

export function getMerchantDemand(merchantId: string, productId: string): number {
  const demand = MERCHANT_DEMAND[merchantId];
  if (!demand) return 0;
  return demand[productId] ?? demand.default ?? 0;
}
