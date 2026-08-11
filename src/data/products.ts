import type { ProductDef } from '../types';
import { CROPS } from './crops';

// Alle verkaufbaren Produkte (Feldfrüchte + Tierprodukte)
export const PRODUCTS: Record<string, ProductDef> = {
  // Crops (gleiche IDs wie in CROPS)
  ...Object.fromEntries(
    Object.values(CROPS).map(c => [c.id, {
      id: c.id, name: c.name, emoji: c.emoji,
      unit: 'kg', sellPricePerUnit: c.sellPricePerKg,
    }])
  ),
  // Tierische Produkte
  eggs:         { id: 'eggs',         name: 'Eier',            emoji: '🥚', unit: 'Stück', sellPricePerUnit: 0.35 },
  milk:         { id: 'milk',         name: 'Milch',           emoji: '🥛', unit: 'L',     sellPricePerUnit: 0.46 },
  pork:         { id: 'pork',         name: 'Schweinefleisch', emoji: '🥩', unit: 'kg',    sellPricePerUnit: 1.80 },
  beef:         { id: 'beef',         name: 'Rindfleisch',     emoji: '🥩', unit: 'kg',    sellPricePerUnit: 3.50 },
  chicken_meat: { id: 'chicken_meat', name: 'Hühnerfleisch',   emoji: '🍗', unit: 'kg',    sellPricePerUnit: 3.20 },
  // Processed products
  flour:         { id: 'flour',         name: 'Mehl',            emoji: '🌾', unit: 'kg',   sellPricePerUnit: 0.90 },
  cheese:        { id: 'cheese',        name: 'Käse',            emoji: '🧀', unit: 'kg',   sellPricePerUnit: 9.00 },
  sausage:       { id: 'sausage',       name: 'Wurst',           emoji: '🌭', unit: 'kg',   sellPricePerUnit: 5.50 },
  sunflower_oil: { id: 'sunflower_oil', name: 'Sonnenblumenöl',  emoji: '🫒', unit: 'L',    sellPricePerUnit: 3.20 },
  butter:        { id: 'butter',        name: 'Butter',          emoji: '🧈', unit: 'kg',   sellPricePerUnit: 7.00 },
  jam:           { id: 'jam',           name: 'Marmelade',       emoji: '🍓', unit: 'Glas', sellPricePerUnit: 2.80 },
  egg_box:       { id: 'egg_box',       name: 'Eierkarton 12er', emoji: '📦', unit: 'Stk',  sellPricePerUnit: 4.20 },
};

export function formatAmount(amount: number, unit: string): string {
  if (unit === 'kg' && amount >= 1000) return `${(amount / 1000).toFixed(1)} t`;
  return `${amount.toLocaleString('de-DE')} ${unit}`;
}

export function productValue(productId: string, amount: number, prices?: Record<string, number>): number {
  const price = prices?.[productId] ?? PRODUCTS[productId]?.sellPricePerUnit ?? 0;
  return Math.round(amount * price);
}

export function totalStorageValue(storage: Record<string, number>, prices?: Record<string, number>): number {
  return Object.entries(storage).reduce((s, [id, amt]) => s + productValue(id, amt, prices), 0);
}
