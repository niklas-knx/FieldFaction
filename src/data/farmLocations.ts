import type { FarmMeta } from '../types';

// Nur der Startstandort ist vordefiniert.
// Weitere Standorte werden vom Spieler per "Standort eröffnen" selbst angelegt.
export const FARM_META: FarmMeta[] = [
  { id: 'muenchen', name: 'Gut Isar', city: 'München', unlocked: true, unlockCost: 0, lat: 48.137, lon: 11.576 },
];

export const NEW_LOCATION_COST = 20_000; // € pro neuem Standort
