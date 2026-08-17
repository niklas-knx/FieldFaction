export type TileState       = 'empty' | 'fallow' | 'being_tilled' | 'tilled' | 'being_planted' | 'planted' | 'ready' | 'being_harvested';
export type Season          = 'spring' | 'summer' | 'autumn' | 'winter';
export type PlotType        = 'field' | 'stall' | 'processing';
export type StallSize       = 'full' | 'half';
export type ProcessingSize  = 'half' | 'quarter' | 'eighth';

export interface CropDef {
  id: string;
  name: string;
  emoji: string;
  seedCost: number;
  sellPricePerKg: number;
  growthTicks: number;
  yieldKg: number;
  color: string;
  description: string;
}

export interface AnimalDef {
  id: string;
  name: string;
  emoji: string;
  buildCostFull: number;
  buildCostHalf: number;
  // Per stall size (full = Freiland, half = Massentierhaltung)
  maxFull: number;                // max Tiere im Freiland-Stall
  maxHalf: number;                // max Tiere im Massen-Stall
  buyCostFull: number;            // € pro Tier (Freiland)
  buyCostHalf: number;            // € pro Tier (Massen, billiger)
  startingAnimalsFull: number;
  startingAnimalsHalf: number;
  happinessFull: number;          // 1.0 = artgerecht
  happinessHalf: number;          // 0.30 = Massentierhaltung
  yieldPerAnimalPerCycle: number; // gleich für beide Typen
  noProductCycle?: boolean;       // wenn true: kein Produkt aus dem Stall (nur Zucht)
  slaughterProductId?: string;    // Output-Produkt im Schlachthof (z.B. 'pork')
  slaughterKgPerAnimal?: number;  // kg Fleisch pro Tier im Schlachthof
  productId: string;
  productName: string;
  productEmoji: string;
  productUnit: string;
  cycleSeconds: number;
  breedingCycleFull: number;      // langsam (natürlich)
  breedingCycleHalf: number;      // schnell (Zukauf/Nachschub)
  sellPricePerUnit: number;
}

export interface ProductDef {
  id: string;
  name: string;
  emoji: string;
  unit: string;
  sellPricePerUnit: number;
}

export interface ProcessingSlot {
  buildingId: string;
  size: ProcessingSize;
  isProcessing: boolean;
  cycleStartTick: number;
  outputReady: number;          // accumulated output ready to collect
  slaughterTarget?: number;      // Schlachthof: wie viele Tiere pro Durchlauf
  slaughterAnimalId?: string;    // Schlachthof: welche Tierart gerade ausgewählt/verarbeitet
  customOutputAmount?: number;   // Schlachthof: berechneter Output für laufenden Batch
}

// One half-stall slot (0.05 ha). Two of these fit in one plot.
export interface StallSlot {
  animalId: string | null;
  animalCount: number;
  productionReady: boolean;
  lastCollectedAt: number;
  lastBreedingAt: number;
}

// A plot is one purchasable land parcel (0.1 ha).
export interface Plot {
  id: number;
  locked: boolean;
  unlockCost: number;
  plotType: PlotType;

  // ── Field state ──
  fieldState: TileState;
  cropId: string | null;
  plantedAt: number;
  growthTicks: number;
  // Active field-work action (tilling / planting / harvesting)
  actionStartTick: number;       // 0 = no action running
  actionDurationTicks: number;   // 0 = no action

  // ── Stall state ──
  // stallSize 'full' → stallA uses whole plot, stallB must be null
  // stallSize 'half' → stallA uses half, stallB can be another half or null (empty)
  stallSize: StallSize;
  stallA: StallSlot;        // primary stall (or full stall)
  stallB: StallSlot | null; // second half stall (only when stallSize === 'half')

  // ── Processing state ──
  processingSlots: ProcessingSlot[];
}

export interface FarmMeta {
  id: string;
  name: string;
  city: string;
  unlocked: boolean;
  unlockCost: number;
  lat: number;
  lon: number;
}

export interface FarmLocation {
  plots: Plot[];
  storage: Record<string, number>; // productId → units (kg, Stück, L)
}

export type EmployeeRole = 'farmer' | 'driver';

export interface Employee {
  uid: number;
  role: EmployeeRole;
  farmId: string;
  wage: number;            // € pro echtem Tag (86.400 Ticks)
  inUseUntilTick: number;  // 0 = frei; > state.tick = im Einsatz
}

export interface OwnedVehicle {
  uid: number;
  defId: string;
  farmId: string;
  inUseUntilTick: number;   // 0 = free; > state.tick = in use
}

export interface OwnedImplement {
  uid: number;
  defId: string;
  farmId: string;
  inUseUntilTick: number;
  pairedVehicleUid: number | null;  // which tractor is currently towing this
}

// ── Markt-System ──────────────────────────────────────────────────────────────

export interface HofladenOffer {
  productId: string;
  pricePerUnit: number;   // Spieler-gesetzter Preis (max 1.8× Basispreis)
  stock: number;          // Eingelagerte Einheiten, physisch getrennt vom Farm-Lager
}

export interface HofladenConfig {
  unlocked: boolean;
  offers: HofladenOffer[];
}

export interface MarketRequest {
  id: number;
  city: string;
  merchantId: string;
  productId: string;
  quantity: number;
  maxPricePerUnit: number;
  expiresAt: number;
  bidCount: number;
}

export interface MarketBid {
  id: number;
  requestId: number;
  farmId: string;
  pricePerUnit: number;
  quantityOffered: number;
  score: number;
  status: 'pending' | 'won' | 'lost';
  createdAt: number;
  request: {
    city: string;
    merchantId: string;
    productId: string;
    quantity: number;
    maxPricePerUnit: number;
    expiresAt: number;
  };
}

export interface ProductChange {
  farmId: string;
  productId: string;
  amount: number; // positiv = hinzufügen, negativ = abziehen
}

export interface MarketCredit {
  id: number;
  amountEur: number;
  productChanges: ProductChange[];
  description: string;
  orderId: number | null;
}

// ── Logistik ──────────────────────────────────────────────────────────────────

export interface Delivery {
  id: number;
  vehicleUid: number;
  fromFarmId: string;
  toFarmId: string;
  productId: string;
  amount: number;
  departTick: number;
  arriveTick: number;
}

// ── Game State ────────────────────────────────────────────────────────────────

export interface GameState {
  money: number;
  tick: number;
  day: number;
  season: Season;
  year: number;
  farms: Record<string, FarmLocation>;
  farmMeta: FarmMeta[];
  activeFarmId: string;
  employees: Employee[];
  selectedCrop: string | null;
  stats: { totalHarvested: number; totalEarned: number; };
  paused: boolean;
  vehicles: OwnedVehicle[];
  implements: OwnedImplement[];
  nextVehicleUid: number;
  nextEmployeeUid: number;
  // Markt-System
  hofladen: Record<string, HofladenConfig>;  // farmId → Hofladen-Konfiguration
  // Dynamische Kurse
  marketPrices: Record<string, number>;      // productId → aktueller Verkaufspreis
  priceHistory: Record<string, number[]>;    // productId → Tagesschlusskurse (älteste zuerst)
  // Logistik
  deliveries: Delivery[];
  nextDeliveryId: number;
}
