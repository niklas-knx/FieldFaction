import type { AnimalDef } from '../types';

// Produktionsvergleich (voll ausgelastet):
//   Freiland:       wenige Tiere × voller Ertrag (100%)
//   Massentier:     viele Tiere  × reduzierter Ertrag (30%)
//
// Voller Stall = 0,1 ha (1.000 m²) → Freilandhaltung
// Halber Stall = 0,05 ha (500 m²)  → Massentierhaltung
export const ANIMALS: Record<string, AnimalDef> = {
  chicken: {
    id: 'chicken',
    name: 'Hühner',
    emoji: '🐓',
    // ─── Stall-Kosten ───────────────────────────────
    buildCostFull: 3500,   // Freilandhaltung (teurer, mehr Platz nötig)
    buildCostHalf: 800,    // Bodenhaltung/Käfig (billig)
    // ─── Freilandhaltung (0,1 ha = 1.000 m²) ───────
    // ~20 m² pro Tier inkl. Auslauf → 50 Hühner
    maxFull: 50,
    buyCostFull: 8,        // Legehenne Freiland: ~8 €
    startingAnimalsFull: 3,
    happinessFull: 1.0,
    breedingCycleFull: 600, // alle 10 min +1 (natürliche Vermehrung)
    // ─── Massentierhaltung (0,05 ha = 500 m²) ───────
    // ~1,5 Tiere/m² (Bodenhaltung DE: 9/m², hier 0,5/m² als Spielwert)
    maxHalf: 250,
    buyCostHalf: 2,        // Legehenne konventionell: ~2 €
    startingAnimalsHalf: 10,
    happinessHalf: 0.30,
    breedingCycleHalf: 180, // alle 3 min +1 (Zukauf aus Brüterei)
    // ─── Schlachthof ────────────────────────────────
    slaughterProductId: 'chicken_meat',
    slaughterKgPerAnimal: 2,
    // ─── Produktion ─────────────────────────────────
    // Realistische Legerate: ~1 Ei/Huhn/Tag, Zyklus = 1 Spieltag (24 Echtstunden, siehe
    // TICKS_PER_DAY) statt der früheren "alle 2 Minuten" — fühlte sich nicht wie ein Hof an.
    yieldPerAnimalPerCycle: 1, // Eier/Tier/Zyklus
    productId: 'eggs',
    productName: 'Eier',
    productEmoji: '🥚',
    productUnit: 'Stück',
    cycleSeconds: 86400,
    sellPricePerUnit: 0.35,
    // Freiland max: 50 × 1 × 1.0 = 50 Eier/Tag = 17,50 €
    // Massen max:  250 × 1 × 0.3 = 75 Eier/Tag = 26,25 €
  },

  cow: {
    id: 'cow',
    name: 'Kühe',
    emoji: '🐄',
    buildCostFull: 15000,
    buildCostHalf: 3500,
    // ─── Freilandhaltung ─────────────────────────────
    // ~125 m² pro Kuh (inkl. Weide) → 8 Kühe
    maxFull: 8,
    buyCostFull: 1200,     // Milchkuh Bio/Freiland: ~1.500 €
    startingAnimalsFull: 1,
    happinessFull: 1.0,
    breedingCycleFull: 1800, // alle 30 min +1
    // ─── Massentierhaltung ────────────────────────────
    // ~17 m² pro Kuh (Anbindestall: ~6 m² + Gangbereich)
    maxHalf: 30,
    buyCostHalf: 350,
    startingAnimalsHalf: 2,
    happinessHalf: 0.30,
    breedingCycleHalf: 600, // alle 10 min +1
    // ─── Schlachthof ────────────────────────────────
    slaughterProductId: 'beef',
    slaughterKgPerAnimal: 150,
    // ─── Produktion ─────────────────────────────────
    // Realistische Milchleistung: ~25 L/Kuh/Tag, Zyklus = 1 Spieltag (24 Echtstunden)
    // statt der früheren "alle 3 Minuten" — analog zur Hühner-Anpassung.
    yieldPerAnimalPerCycle: 25, // L Milch/Kuh/Zyklus
    productId: 'milk',
    productName: 'Milch',
    productEmoji: '🥛',
    productUnit: 'L',
    cycleSeconds: 86400,
    sellPricePerUnit: 0.46,
    // Freiland max: 8  × 25 × 1.0 = 200 L/Tag = 92 €
    // Massen max:  30  × 25 × 0.3 = 225 L/Tag = 103,50 €
  },

  pig: {
    id: 'pig',
    name: 'Schweine',
    emoji: '🐷',
    buildCostFull: 6000,
    buildCostHalf: 1200,
    // ─── Freilandhaltung ─────────────────────────────
    // ~50 m² pro Schwein (Weidehaltung) → 20 Tiere
    maxFull: 20,
    buyCostFull: 150,
    startingAnimalsFull: 2,
    happinessFull: 1.0,
    breedingCycleFull: 900, // alle 15 min +1
    // ─── Massentierhaltung ────────────────────────────
    // ~1,0 m² pro Tier (DE-Mindeststandard) → 500 m² / 1 m² = 500
    // Spielwert: 60 für bessere Handhabbarkeit
    maxHalf: 60,
    buyCostHalf: 45,
    startingAnimalsHalf: 5,
    happinessHalf: 0.30,
    breedingCycleHalf: 300, // alle 5 min +1
    // ─── Schlachthof ────────────────────────────────
    slaughterProductId: 'pork',
    slaughterKgPerAnimal: 50,
    // Schweine produzieren kein Produkt direkt – nur Zucht.
    // Fleisch kommt ausschließlich über den Schlachthof.
    noProductCycle: true,
    yieldPerAnimalPerCycle: 0,
    productId: 'pork',
    productName: 'Fleisch',
    productEmoji: '🥩',
    productUnit: 'kg',
    cycleSeconds: 999999,
    sellPricePerUnit: 1.80,
  },
};

export const ANIMAL_LIST = Object.values(ANIMALS);

export function getMaxAnimals(animalId: string, size: 'full' | 'half'): number {
  const a = ANIMALS[animalId];
  if (!a) return 0;
  return size === 'full' ? a.maxFull : a.maxHalf;
}

export function getBuyCost(animalId: string, size: 'full' | 'half'): number {
  const a = ANIMALS[animalId];
  if (!a) return 0;
  return size === 'full' ? a.buyCostFull : a.buyCostHalf;
}

export function getBreedingCycle(animalId: string, size: 'full' | 'half'): number {
  const a = ANIMALS[animalId];
  if (!a) return 600;
  return size === 'full' ? a.breedingCycleFull : a.breedingCycleHalf;
}

export function getStartingAnimals(animalId: string, size: 'full' | 'half'): number {
  const a = ANIMALS[animalId];
  if (!a) return 1;
  return size === 'full' ? a.startingAnimalsFull : a.startingAnimalsHalf;
}

export function computeYield(animalId: string, animalCount: number, size: 'full' | 'half'): number {
  const a = ANIMALS[animalId];
  if (!a || animalCount === 0) return 0;
  const happiness = size === 'full' ? a.happinessFull : a.happinessHalf;
  return Math.floor(animalCount * a.yieldPerAnimalPerCycle * happiness);
}

// Wie oft am Tag der Stall manuell geleert werden muss, bevor die Produktion pausiert —
// Tiere legen/produzieren nicht mehr alle gleichzeitig am Zyklusende, sondern laufend über
// den Tag verteilt in einen Puffer (StallSlot.outputReady), der bei Erreichen dieser
// Kapazität stoppt, bis der Spieler ihn einsammelt (siehe tickGame() in Farm.ts).
// 1 = Kapazität entspricht dem vollen Tagesertrag → 1x/Tag einsammeln reicht.
const COLLECTIONS_PER_DAY = 1;

export function stallCapacity(animalId: string, animalCount: number, size: 'full' | 'half'): number {
  const dailyYield = computeYield(animalId, animalCount, size);
  if (dailyYield <= 0) return 0;
  return Math.max(1, Math.ceil(dailyYield / COLLECTIONS_PER_DAY));
}

export function happinessMultiplier(size: 'full' | 'half'): number {
  // Used externally if needed
  return size === 'full' ? 1.0 : 0.30;
}

export function happinessLabel(size: 'full' | 'half'): string {
  return size === 'full' ? '😊 Freilandhaltung' : '😟 Massentierhaltung';
}

export function happinessHearts(size: 'full' | 'half'): string {
  return size === 'full' ? '♥♥♥♥♥' : '♥░░░░';
}
