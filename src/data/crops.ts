import type { CropDef } from '../types';

// Basis: 1 Feld = 0,1 ha (1.000 m²)
// Erträge nach deutschen Durchschnittswerten (Destatis / LfL Bayern)
// Preise: aktuelle Erzeugerpreise ca. 2023/24
// 1 Tag = 86.400 Ticks (1 Tick/Sekunde Echtzeit)
const DAY = 86_400;

export const CROPS: Record<string, CropDef> = {
  wheat: {
    id: 'wheat',
    name: 'Weizen',
    emoji: '🌾',
    seedCost: 30,
    sellPricePerKg: 0.20,
    growthTicks: 5 * DAY,  // 5 Tage
    yieldKg: 750,
    color: '#DAA520',
    description: '0,1 ha · Ø 7,5 t/ha · 5 Tage',
  },
  potato: {
    id: 'potato',
    name: 'Kartoffel',
    emoji: '🥔',
    seedCost: 55,
    sellPricePerKg: 0.09,
    growthTicks: 4 * DAY,  // 4 Tage
    yieldKg: 4500,
    color: '#8B6914',
    description: '0,1 ha · Ø 45 t/ha · 4 Tage',
  },
  corn: {
    id: 'corn',
    name: 'Mais',
    emoji: '🌽',
    seedCost: 70,
    sellPricePerKg: 0.19,
    growthTicks: 6 * DAY,  // 6 Tage
    yieldKg: 950,
    color: '#FFD700',
    description: '0,1 ha · Ø 9,5 t/ha · 6 Tage',
  },
  tomato: {
    id: 'tomato',
    name: 'Tomate',
    emoji: '🍅',
    seedCost: 110,
    sellPricePerKg: 0.55,
    growthTicks: 3 * DAY,  // 3 Tage
    yieldKg: 6000,
    color: '#E53935',
    description: '0,1 ha · Ø 60 t/ha · 3 Tage',
  },
  sunflower: {
    id: 'sunflower',
    name: 'Sonnenblume',
    emoji: '🌻',
    seedCost: 22,
    sellPricePerKg: 0.38,
    growthTicks: 5 * DAY,  // 5 Tage
    yieldKg: 250,
    color: '#FFC107',
    description: '0,1 ha · Ø 2,5 t/ha · 5 Tage',
  },
  strawberry: {
    id: 'strawberry',
    name: 'Erdbeere',
    emoji: '🍓',
    seedCost: 160,
    sellPricePerKg: 1.80,
    growthTicks: 8 * DAY,  // 8 Tage
    yieldKg: 1500,
    color: '#E91E63',
    description: '0,1 ha · Ø 15 t/ha · 8 Tage',
  },
};

export const CROP_LIST = Object.values(CROPS);

// Ertrag formatiert anzeigen
export function formatKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} t`;
  return `${kg.toLocaleString('de-DE')} kg`;
}
