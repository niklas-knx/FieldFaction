import type { ProcessingSize, ProcessingSlot } from '../types';

export interface ProcessingDef {
  id: string;
  name: string;
  emoji: string;
  size: ProcessingSize;
  buildCost: number;
  inputProductId: string;
  inputAmount: number;
  outputProductId: string;
  outputAmount: number;
  cycleSeconds: number;
  baseId: string;       // groups normal + large together in the UI
  tier: 'normal' | 'large';
  // Schlachthof-Felder: Input kommt direkt aus Ställen, nicht aus dem Lager
  inputFromStall?: string;  // animalId (z.B. 'pig', 'cow', 'chicken')
  kgPerAnimal?: number;     // Fleisch-Output pro Tier in kg
}

export const PROCESSING_BUILDINGS: Record<string, ProcessingDef> = {
  // ─── Getreidemühle ──────────────────────────────────────────────────────────
  flour_mill: {
    id: 'flour_mill', name: 'Getreidemühle', emoji: '🏭',
    size: 'quarter', buildCost: 18000, cycleSeconds: 180,
    inputProductId: 'wheat',  inputAmount: 150,
    outputProductId: 'flour', outputAmount: 125,
    baseId: 'flour_mill', tier: 'normal',
  },
  flour_mill_large: {
    id: 'flour_mill_large', name: 'Getreidemühle (Groß)', emoji: '🏭',
    size: 'half', buildCost: 45000, cycleSeconds: 180,
    inputProductId: 'wheat',  inputAmount: 375,
    outputProductId: 'flour', outputAmount: 315,
    baseId: 'flour_mill', tier: 'large',
  },

  // ─── Käserei ────────────────────────────────────────────────────────────────
  cheese_dairy: {
    id: 'cheese_dairy', name: 'Käserei', emoji: '🧀',
    size: 'quarter', buildCost: 22000, cycleSeconds: 300,
    inputProductId: 'milk',    inputAmount: 100,
    outputProductId: 'cheese', outputAmount: 8,
    baseId: 'cheese_dairy', tier: 'normal',
  },
  cheese_dairy_large: {
    id: 'cheese_dairy_large', name: 'Käserei (Groß)', emoji: '🧀',
    size: 'half', buildCost: 55000, cycleSeconds: 300,
    inputProductId: 'milk',    inputAmount: 250,
    outputProductId: 'cheese', outputAmount: 20,
    baseId: 'cheese_dairy', tier: 'large',
  },

  // ─── Wursterei ──────────────────────────────────────────────────────────────
  sausage_kitchen: {
    id: 'sausage_kitchen', name: 'Wursterei', emoji: '🌭',
    size: 'quarter', buildCost: 16000, cycleSeconds: 180,
    inputProductId: 'pork',    inputAmount: 20,
    outputProductId: 'sausage', outputAmount: 15,
    baseId: 'sausage_kitchen', tier: 'normal',
  },
  sausage_kitchen_large: {
    id: 'sausage_kitchen_large', name: 'Wursterei (Groß)', emoji: '🌭',
    size: 'half', buildCost: 38000, cycleSeconds: 180,
    inputProductId: 'pork',    inputAmount: 50,
    outputProductId: 'sausage', outputAmount: 38,
    baseId: 'sausage_kitchen', tier: 'large',
  },

  // ─── Ölpresse ───────────────────────────────────────────────────────────────
  oil_press: {
    id: 'oil_press', name: 'Ölpresse', emoji: '🫒',
    size: 'quarter', buildCost: 14000, cycleSeconds: 240,
    inputProductId: 'sunflower',    inputAmount: 30,
    outputProductId: 'sunflower_oil', outputAmount: 10,
    baseId: 'oil_press', tier: 'normal',
  },
  oil_press_large: {
    id: 'oil_press_large', name: 'Ölpresse (Groß)', emoji: '🫒',
    size: 'half', buildCost: 32000, cycleSeconds: 240,
    inputProductId: 'sunflower',    inputAmount: 75,
    outputProductId: 'sunflower_oil', outputAmount: 25,
    baseId: 'oil_press', tier: 'large',
  },

  // ─── Butterei ───────────────────────────────────────────────────────────────
  butter_churn: {
    id: 'butter_churn', name: 'Butterei', emoji: '🧈',
    size: 'eighth', buildCost: 4500, cycleSeconds: 90,
    inputProductId: 'milk',   inputAmount: 20,
    outputProductId: 'butter', outputAmount: 5,
    baseId: 'butter_churn', tier: 'normal',
  },
  butter_churn_large: {
    id: 'butter_churn_large', name: 'Butterei (Groß)', emoji: '🧈',
    size: 'quarter', buildCost: 11000, cycleSeconds: 90,
    inputProductId: 'milk',   inputAmount: 50,
    outputProductId: 'butter', outputAmount: 13,
    baseId: 'butter_churn', tier: 'large',
  },

  // ─── Einmachküche ───────────────────────────────────────────────────────────
  jam_kitchen: {
    id: 'jam_kitchen', name: 'Einmachküche', emoji: '🍓',
    size: 'eighth', buildCost: 3500, cycleSeconds: 120,
    inputProductId: 'strawberry', inputAmount: 15,
    outputProductId: 'jam',        outputAmount: 10,
    baseId: 'jam_kitchen', tier: 'normal',
  },
  jam_kitchen_large: {
    id: 'jam_kitchen_large', name: 'Einmachküche (Groß)', emoji: '🍓',
    size: 'quarter', buildCost: 8500, cycleSeconds: 120,
    inputProductId: 'strawberry', inputAmount: 38,
    outputProductId: 'jam',        outputAmount: 25,
    baseId: 'jam_kitchen', tier: 'large',
  },

  // ─── Schlachthof (universal) ─────────────────────────────────────────────
  slaughterhouse: {
    id: 'slaughterhouse', name: 'Schlachthof', emoji: '🔪',
    size: 'quarter', buildCost: 15000, cycleSeconds: 120,
    inputProductId: '', inputAmount: 0,
    outputProductId: '', outputAmount: 0,
    baseId: 'slaughterhouse', tier: 'normal',
    inputFromStall: 'any',
  },
  slaughterhouse_large: {
    id: 'slaughterhouse_large', name: 'Schlachthof (Groß)', emoji: '🔪',
    size: 'half', buildCost: 35000, cycleSeconds: 120,
    inputProductId: '', inputAmount: 0,
    outputProductId: '', outputAmount: 0,
    baseId: 'slaughterhouse', tier: 'large',
    inputFromStall: 'any',
  },

  // ─── Eiersortierung ───────────────────────────────────────────────────────
  egg_sorting: {
    id: 'egg_sorting', name: 'Eiersortierung', emoji: '📦',
    size: 'eighth', buildCost: 2500, cycleSeconds: 60,
    inputProductId: 'eggs',    inputAmount: 12,
    outputProductId: 'egg_box', outputAmount: 1,
    baseId: 'egg_sorting', tier: 'normal',
  },
  egg_sorting_large: {
    id: 'egg_sorting_large', name: 'Eiersortierung (Groß)', emoji: '📦',
    size: 'quarter', buildCost: 6000, cycleSeconds: 60,
    inputProductId: 'eggs',    inputAmount: 30,
    outputProductId: 'egg_box', outputAmount: 3,
    baseId: 'egg_sorting', tier: 'large',
  },

};

export const PROCESSING_LIST = Object.values(PROCESSING_BUILDINGS);

// Unique base IDs in display order
export const PROCESSING_BASES = [...new Set(PROCESSING_LIST.map(b => b.baseId))];

export const PLOT_TOTAL_UNITS = 8;

export function processingSpaceUnits(size: ProcessingSize): number {
  if (size === 'half')    return 4;
  if (size === 'quarter') return 2;
  return 1;
}

export function usedSpaceUnits(slots: Pick<ProcessingSlot, 'size'>[]): number {
  return slots.reduce((s, sl) => s + processingSpaceUnits(sl.size), 0);
}

export function freeSpaceUnits(slots: Pick<ProcessingSlot, 'size'>[]): number {
  return PLOT_TOTAL_UNITS - usedSpaceUnits(slots);
}

const FRACTION: Record<number, string> = {
  1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞', 8: '1',
};

export function sizeLabel(size: ProcessingSize): string {
  if (size === 'half')    return '½';
  if (size === 'quarter') return '¼';
  return '⅛';
}

export function sizeHa(size: ProcessingSize): string {
  if (size === 'half')    return '0,05 ha';
  if (size === 'quarter') return '0,025 ha';
  return '0,0125 ha';
}

export function freeUnitsLabel(units: number): string {
  return FRACTION[units] ?? `${units}/8`;
}
