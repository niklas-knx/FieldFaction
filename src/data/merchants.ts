export interface MerchantDef {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  defaultMultiplier: number;              // for products not explicitly listed
  priceMultipliers: Record<string, number>; // productId → multiplier on base price
  // Aufnahmekapazität pro 60s-Matching-Runde (0 = kauft Produkt nicht)
  demandPerRound: Record<string, number>; // productId → units; 'default' als Fallback
}

export const MERCHANTS: Record<string, MerchantDef> = {
  grosshandel: {
    id: 'grosshandel', name: 'Großmarkt', emoji: '🏪',
    tagline: 'Wir nehmen alles — zu Großhandelspreisen.',
    defaultMultiplier: 0.85,
    priceMultipliers: {},
    demandPerRound: { default: 2000 },
  },
  supermarkt: {
    id: 'supermarkt', name: 'Supermarkt', emoji: '🛒',
    tagline: 'Vollsortiment zu fairen Marktpreisen.',
    defaultMultiplier: 1.00,
    priceMultipliers: { eggs: 1.10, egg_box: 1.10 },
    demandPerRound: { default: 500, milk: 600, eggs: 800 },
  },
  molkerei: {
    id: 'molkerei', name: 'Molkerei', emoji: '🧀',
    tagline: 'Nur Milchprodukte — dafür zu Höchstpreisen.',
    defaultMultiplier: 0,
    priceMultipliers: { milk: 1.35, butter: 1.30, cheese: 1.45, eggs: 1.10 },
    demandPerRound: { default: 0, milk: 1200, cheese: 300, butter: 600, eggs: 200 },
  },
  fleischerei: {
    id: 'fleischerei', name: 'Fleischerei', emoji: '🥩',
    tagline: 'Nur Fleisch und Wurstwaren.',
    defaultMultiplier: 0,
    priceMultipliers: { pork: 1.40, sausage: 1.38, eggs: 1.15 },
    demandPerRound: { default: 0, pork: 600, beef: 400, chicken_meat: 400, sausage: 400, eggs: 300 },
  },
  baeckerei: {
    id: 'baeckerei', name: 'Bäckerei', emoji: '🍞',
    tagline: 'Nur Backzutaten.',
    defaultMultiplier: 0,
    priceMultipliers: { flour: 1.35, eggs: 1.20, milk: 1.10, wheat: 1.12 },
    demandPerRound: { default: 0, flour: 800, eggs: 400, milk: 300, wheat: 500 },
  },
  getreideboerse: {
    id: 'getreideboerse', name: 'Getreidebörse', emoji: '🌾',
    tagline: 'Nur Getreide und Körnerfrüchte.',
    defaultMultiplier: 0,
    priceMultipliers: { wheat: 1.22, corn: 1.18, flour: 1.28, sunflower: 1.15 },
    demandPerRound: { default: 0, wheat: 2000, corn: 1500, flour: 600, sunflower: 800, potato: 1000 },
  },
  biomarkt: {
    id: 'biomarkt', name: 'Biomarkt', emoji: '🌿',
    tagline: 'Alles — natürlich mit Bioaufschlag.',
    defaultMultiplier: 1.15,
    priceMultipliers: { jam: 1.30, sunflower_oil: 1.25, butter: 1.22, cheese: 1.28 },
    demandPerRound: { default: 300, jam: 200, sunflower_oil: 200, butter: 300, cheese: 200 },
  },
  feinkost: {
    id: 'feinkost', name: 'Feinkosthandel', emoji: '🫙',
    tagline: 'Nur hochwertige Veredelungsprodukte.',
    defaultMultiplier: 0,
    priceMultipliers: {
      sausage: 1.48, cheese: 1.45, jam: 1.40, sunflower_oil: 1.35,
      butter: 1.30, egg_box: 1.32,
    },
    demandPerRound: { default: 0, sausage: 200, cheese: 200, jam: 300, sunflower_oil: 200, butter: 200, egg_box: 300 },
  },
  exporteur: {
    id: 'exporteur', name: 'Exporteur', emoji: '🚢',
    tagline: 'Alles — große Mengen erwünscht.',
    defaultMultiplier: 0.92,
    priceMultipliers: {},
    demandPerRound: { default: 3000 },
  },
  konserven: {
    id: 'konserven', name: 'Konservenfabrik', emoji: '🥫',
    tagline: 'Nur Obst, Gemüse und Konservenprodukte.',
    defaultMultiplier: 0,
    priceMultipliers: { tomato: 1.28, strawberry: 1.22, jam: 1.32, corn: 1.15 },
    demandPerRound: { default: 0, tomato: 1000, strawberry: 800, jam: 500, corn: 1200 },
  },
};

// Which merchants appear at each farm location
export const CITY_MERCHANTS: Record<string, string[]> = {
  muenchen:  ['molkerei',      'fleischerei',  'grosshandel'  ],
  nuernberg: ['getreideboerse','baeckerei',    'grosshandel'  ],
  stuttgart: ['biomarkt',      'konserven',    'supermarkt'   ],
  frankfurt: ['feinkost',      'exporteur',    'supermarkt'   ],
  leipzig:   ['getreideboerse','fleischerei',  'grosshandel'  ],
  koeln:     ['feinkost',      'supermarkt',   'exporteur'    ],
  hamburg:   ['exporteur',     'molkerei',     'grosshandel'  ],
  berlin:    ['biomarkt',      'feinkost',     'supermarkt'   ],
};

export function merchantPrice(merchant: MerchantDef, productId: string, basePrice: number): number {
  const mult = merchant.priceMultipliers[productId] ?? merchant.defaultMultiplier;
  if (mult <= 0) return 0; // merchant won't buy this product
  return basePrice * mult;
}

export function topOffers(merchant: MerchantDef, n = 3): { productId: string; mult: number }[] {
  return Object.entries(merchant.priceMultipliers)
    .map(([productId, mult]) => ({ productId, mult }))
    .filter(o => o.mult > merchant.defaultMultiplier)
    .sort((a, b) => b.mult - a.mult)
    .slice(0, n);
}
