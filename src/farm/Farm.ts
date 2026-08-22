import type { GameState, FarmLocation, FarmMeta, Plot, StallSlot, Season, StallSize, ProcessingSlot, OwnedVehicle, OwnedImplement, Delivery, Employee, EmployeeRole, MarketCredit } from '../types';
import { VEHICLES } from '../data/vehicles';
import { IMPLEMENTS } from '../data/implements';
import { CROPS } from '../data/crops';
import { ANIMALS, computeYield, stallCapacity, getMaxAnimals, getBuyCost, getBreedingCycle, getStartingAnimals } from '../data/animals';
import { PROCESSING_BUILDINGS, processingSpaceUnits, usedSpaceUnits, PLOT_TOTAL_UNITS } from '../data/processing';
import { FARM_META } from '../data/farmLocations';
import { PRODUCTS, formatAmount } from '../data/products';
import { EMPLOYEE_ROLES } from '../data/employees';
import { bus } from '../core/EventBus';

// Echtzeit-Spiel: 1 Tick = 1 Sekunde Echtzeit, 1 Spieltag = 1 echter Tag (86.400 Ticks) — wie Feldarbeit/Wachstum.
export const TICKS_PER_DAY     = 86_400;
export const DAYS_PER_SEASON   = 28;
export const MAX_PLOTS         = 12;
export const FIELD_WORK_TICKS  = 900; // 15 Minuten Traktorarbeit pro Parzelle

export const PLOT_UNLOCK_COSTS = [0,0,0, 200,400,800, 1500,3000,5000, 8000,12000,18000];

// ── Kredit ────────────────────────────────────────────────────────────────────
export const MAX_DEBT           = 10_000; // Kreditlimit (2× Startkapital)
export const DEBT_INTEREST_RATE = 0.02;   // 2 %/Spieltag auf die offene Summe

// ── Logistik ──────────────────────────────────────────────────────────────────
export const TRANSPORT_CAPACITY      = 5000; // max. Einheiten pro Fahrt
// 1 Tick = 1 Sekunde Echtzeit (wie Feldarbeit/Wachstum) — Fahrzeit entspricht also einer echten LKW-Fahrt.
const TRANSPORT_BASE_TICKS   = 1800; // 30 Minuten Be-/Entladen am Standort
const TRANSPORT_AVG_KMH      = 65;   // Ø-Geschwindigkeit LKW (Autobahn-Tempolimit, Pausen, Stadtverkehr eingerechnet)
const TRANSPORT_TICKS_PER_KM = 3600 / TRANSPORT_AVG_KMH; // Sekunden Fahrzeit pro km Luftlinie

// Luftlinien-Distanz zwischen zwei Standorten (Haversine)
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function transportDurationTicks(km: number): number {
  return TRANSPORT_BASE_TICKS + Math.round(km * TRANSPORT_TICKS_PER_KM);
}

export function findFreeTransporter(state: GameState, farmId: string): OwnedVehicle | undefined {
  return state.vehicles.find(v => v.farmId === farmId && v.defId === 'transporter' && v.inUseUntilTick <= state.tick);
}

export function startDelivery(
  state: GameState, fromFarmId: string, toFarmId: string, productId: string, amount: number,
): GameState {
  if (fromFarmId === toFarmId) return state;
  const fromFarm = state.farms[fromFarmId];
  const fromMeta = state.farmMeta.find(m => m.id === fromFarmId);
  const toMeta   = state.farmMeta.find(m => m.id === toFarmId);
  if (!fromFarm || !fromMeta || !toMeta) return state;

  const available = fromFarm.storage[productId] ?? 0;
  const actual = Math.min(amount, available, TRANSPORT_CAPACITY);
  if (actual <= 0) return state;

  const truck  = findFreeTransporter(state, fromFarmId);
  const driver = findFreeEmployee(state, fromFarmId, 'driver');
  if (!truck)  { bus.emit('notification', '🚛 Kein freier Transporter am Standort — kaufe einen im Fahrzeug-Shop'); return state; }
  if (!driver) { bus.emit('notification', '🚚 Kein freier LKW-Fahrer am Standort — stelle einen im Personal-Menü ein'); return state; }

  const km = distanceKm(fromMeta.lat, fromMeta.lon, toMeta.lat, toMeta.lon);
  const durationTicks = transportDurationTicks(km);
  const arriveTick = state.tick + durationTicks;

  const delivery: Delivery = {
    id: state.nextDeliveryId,
    vehicleUid: truck.uid,
    fromFarmId, toFarmId, productId, amount: actual,
    departTick: state.tick, arriveTick,
  };

  const prod = PRODUCTS[productId];
  bus.emit('notification',
    `🚛 ${formatAmount(actual, prod?.unit ?? '')} ${prod?.name ?? productId} unterwegs nach ${toMeta.city} (${Math.ceil(durationTicks / 60)} Min.)`);

  const withStorage = updateFarm(state, fromFarmId, { storage: { ...fromFarm.storage, [productId]: available - actual } });
  return {
    ...withStorage,
    vehicles: withStorage.vehicles.map(v => v.uid === truck.uid ? { ...v, inUseUntilTick: arriveTick } : v),
    employees: withStorage.employees.map(e => e.uid === driver.uid ? { ...e, inUseUntilTick: arriveTick } : e),
    deliveries: [...withStorage.deliveries, delivery],
    nextDeliveryId: withStorage.nextDeliveryId + 1,
  };
}

const SEASONS: Season[] = ['spring','summer','autumn','winter'];
const SEASON_NAMES: Record<Season,string> = {
  spring:'Frühling', summer:'Sommer', autumn:'Herbst', winter:'Winter',
};
export const seasonName = (s: Season) => SEASON_NAMES[s];

// ── Kurse ─────────────────────────────────────────────────────────────────────
export const PRICE_HISTORY_DAYS = 30;
const PRICE_REVERSION   = 0.15; // Anteil, zu dem sich der Kurs täglich Richtung Zielpreis bewegt
const PRICE_VOLATILITY  = 0.03; // zufälliges Tagesrauschen, relativ zum Basispreis
const PRICE_MIN_FACTOR  = 0.5;  // Untergrenze relativ zum Basispreis
const PRICE_MAX_FACTOR  = 1.6;  // Obergrenze relativ zum Basispreis
const YEAR_LENGTH_DAYS  = DAYS_PER_SEASON * 4; // 112 Tage/Jahr

// Erntesaison (bzw. Hauptsaison) je Produkt — dort ist das Angebot hoch und der Kurs tendenziell
// günstiger; ein halbes Jahr später (Nebensaison) ist es knapp und tendenziell teurer.
// Rohprodukte schwanken stärker als daraus Verarbeitetes (Lagerpuffer glättet die Schwankung).
interface SeasonalityDef { peak: Season; amplitude: number; }
const PRODUCT_SEASONALITY: Record<string, SeasonalityDef> = {
  // Feldfrüchte
  wheat:         { peak: 'summer', amplitude: 0.12 },
  potato:        { peak: 'autumn', amplitude: 0.12 },
  corn:          { peak: 'autumn', amplitude: 0.12 },
  tomato:        { peak: 'summer', amplitude: 0.12 },
  sunflower:     { peak: 'autumn', amplitude: 0.12 },
  strawberry:    { peak: 'spring', amplitude: 0.12 },
  // Tierprodukte (Weide-/Legesaison bzw. traditionelle Herbstschlachtung)
  milk:          { peak: 'spring', amplitude: 0.10 },
  eggs:          { peak: 'summer', amplitude: 0.10 },
  beef:          { peak: 'autumn', amplitude: 0.10 },
  // Verarbeitete Produkte — folgen ihrem Rohstoff, gedämpft
  flour:         { peak: 'summer', amplitude: 0.06 },
  cheese:        { peak: 'spring', amplitude: 0.06 },
  butter:        { peak: 'spring', amplitude: 0.06 },
  sausage:       { peak: 'autumn', amplitude: 0.06 },
  sunflower_oil: { peak: 'autumn', amplitude: 0.06 },
  jam:           { peak: 'spring', amplitude: 0.06 },
  egg_box:       { peak: 'summer', amplitude: 0.06 },
  // pork, chicken_meat: ganzjährige Stallproduktion → keine Saisonalität
};

function seasonCenterDay(season: Season): number {
  return SEASONS.indexOf(season) * DAYS_PER_SEASON + DAYS_PER_SEASON / 2;
}

// Saisonaler Faktor als glatte Kosinuskurve übers Jahr: 1-amplitude in der Erntesaison,
// 1+amplitude ein halbes Jahr später, dazwischen stetiger Übergang (keine Sprünge am Saisonwechsel).
function seasonalFactor(productId: string, dayOfYear: number): number {
  const def = PRODUCT_SEASONALITY[productId];
  if (!def) return 1;
  let diff = Math.abs(dayOfYear - seasonCenterDay(def.peak));
  if (diff > YEAR_LENGTH_DAYS / 2) diff = YEAR_LENGTH_DAYS - diff;
  const angle = (diff / (YEAR_LENGTH_DAYS / 2)) * Math.PI;
  return 1 - def.amplitude * Math.cos(angle);
}

// Saisonfaktor für die UI: null = Produkt hat keine Saisonalität hinterlegt
export function seasonalPriceFactor(productId: string, day: number): number | null {
  if (!PRODUCT_SEASONALITY[productId]) return null;
  return seasonalFactor(productId, (day - 1) % YEAR_LENGTH_DAYS);
}

function initialMarketPrices(): Record<string, number> {
  const prices: Record<string, number> = {};
  Object.values(PRODUCTS).forEach(p => { prices[p.id] = p.sellPricePerUnit; });
  return prices;
}

function initialPriceHistory(): Record<string, number[]> {
  const history: Record<string, number[]> = {};
  Object.values(PRODUCTS).forEach(p => { history[p.id] = [p.sellPricePerUnit]; });
  return history;
}

function nextDailyPrice(base: number, target: number, current: number): number {
  const reversion = (target - current) * PRICE_REVERSION;
  const noise     = (Math.random() * 2 - 1) * base * PRICE_VOLATILITY;
  const next      = current + reversion + noise;
  const clamped   = Math.min(base * PRICE_MAX_FACTOR, Math.max(base * PRICE_MIN_FACTOR, next));
  return Math.round(clamped * 100) / 100;
}

function advanceMarketPrices(state: GameState, newDay: number): Pick<GameState, 'marketPrices' | 'priceHistory'> {
  const dayOfYear = (newDay - 1) % YEAR_LENGTH_DAYS;
  const marketPrices: Record<string, number> = { ...state.marketPrices };
  const priceHistory: Record<string, number[]> = { ...state.priceHistory };
  for (const p of Object.values(PRODUCTS)) {
    const current = marketPrices[p.id] ?? p.sellPricePerUnit;
    const target   = p.sellPricePerUnit * seasonalFactor(p.id, dayOfYear);
    const next     = nextDailyPrice(p.sellPricePerUnit, target, current);
    marketPrices[p.id] = next;
    priceHistory[p.id] = [...(priceHistory[p.id] ?? [p.sellPricePerUnit]), next].slice(-PRICE_HISTORY_DAYS);
  }
  return { marketPrices, priceHistory };
}

// Aktueller Kurs eines Produkts (fällt auf den statischen Basispreis zurück, z.B. für alte Spielstände)
export function currentPrice(state: GameState, productId: string): number {
  return state.marketPrices[productId] ?? PRODUCTS[productId]?.sellPricePerUnit ?? 0;
}

function emptyStallSlot(tick = 0): StallSlot {
  return { animalId: null, animalCount: 0, outputReady: 0, productionAccum: 0, lastCollectedAt: tick, lastBreedingAt: tick };
}

function makePlot(id: number): Plot {
  return {
    id, locked: id >= 3, unlockCost: PLOT_UNLOCK_COSTS[id] ?? 0,
    plotType: 'field',
    fieldState: 'empty', cropId: null, plantedAt: 0, growthTicks: 0,
    actionStartTick: 0, actionDurationTicks: 0,
    stallSize: 'full', stallA: emptyStallSlot(), stallB: null,
    processingSlots: [],
  };
}

function makeFarm(): FarmLocation {
  return { plots: Array.from({ length: MAX_PLOTS }, (_, i) => makePlot(i)), storage: {} };
}

// Frei wählbarer Startort (siehe server/src/routes/game.ts POST /start): ohne Angabe
// fällt der Startort auf den vordefinierten Standort in FARM_META zurück (München),
// damit bestehende Aufrufe von createInitialState() unverändert funktionieren.
export interface StartLocationInput {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

export function createInitialState(start?: StartLocationInput): GameState {
  const startMeta: FarmMeta = start
    ? { id: start.id, name: start.name, city: start.city, unlocked: true, unlockCost: 0, lat: start.lat, lon: start.lon }
    : FARM_META[0];
  const farmId = startMeta.id;

  return {
    money: 5_000, debt: 0, tick: 0, day: 1, season: 'spring', year: 1,
    farms: { [farmId]: makeFarm() }, farmMeta: [startMeta], activeFarmId: farmId,
    employees: [
      { uid: 1, role: 'farmer', farmId, wage: EMPLOYEE_ROLES.farmer.wagePerDay, inUseUntilTick: 0 },
    ],
    selectedCrop: 'wheat',
    stats: { totalHarvested: 0, totalEarned: 0 },
    paused: false,
    hofladen: {},
    marketPrices: initialMarketPrices(),
    priceHistory: initialPriceHistory(),
    deliveries: [],
    nextDeliveryId: 1,
    // Starter equipment — the old family farm machinery
    vehicles: [
      { uid: 1, defId: 'traktor', farmId, inUseUntilTick: 0 },
    ],
    implements: [
      { uid: 2, defId: 'pflug',       farmId, inUseUntilTick: 0, pairedVehicleUid: null },
      { uid: 3, defId: 'saemaschine', farmId, inUseUntilTick: 0, pairedVehicleUid: null },
    ],
    nextVehicleUid: 4,
    nextEmployeeUid: 2,
  };
}

function updateFarm(state: GameState, farmId: string, upd: Partial<FarmLocation>): GameState {
  return { ...state, farms: { ...state.farms, [farmId]: { ...state.farms[farmId], ...upd } } };
}

function updPlot(farm: FarmLocation, plotId: number, upd: Partial<Plot>): Plot[] {
  return farm.plots.map(p => p.id === plotId ? { ...p, ...upd } : p);
}

// ── Tick ──────────────────────────────────────────────────────────────────────

// Ereignisse, die während eines Ticks passiert sind — für einen "Willkommen zurück"-Rückblick
// nach dem Offline-Nachholen gesammelt, statt einzeln als Notification zu feuern (würde bei
// tausenden nachgeholten Ticks spammen).
export interface DeliveryArrivedEvent { productId: string; amount: number; fromFarmId: string; toFarmId: string; }
export interface EmployeeFiredEvent { role: EmployeeRole; wage: number; }

export interface TickEvents {
  fieldsHarvested: number;
  stallCollectionsReady: number;
  processingCompleted: number;
  deliveriesArrived: DeliveryArrivedEvent[];
  employeesFired: EmployeeFiredEvent[];
  wagesPaid: number;
  interestAccrued: number;
}

export function emptyTickEvents(): TickEvents {
  return {
    fieldsHarvested: 0, stallCollectionsReady: 0, processingCompleted: 0,
    deliveriesArrived: [], employeesFired: [], wagesPaid: 0, interestAccrued: 0,
  };
}

export function tickGame(state: GameState): { state: GameState; events: TickEvents } {
  if (state.paused) return { state, events: emptyTickEvents() };
  const tick = state.tick + 1;
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const day    = totalDays + 1;
  const season = SEASONS[Math.floor(totalDays / DAYS_PER_SEASON) % 4];
  const year   = Math.floor(totalDays / (DAYS_PER_SEASON * 4)) + 1;

  const events = emptyTickEvents();
  const farms: Record<string, FarmLocation> = {};
  let statsDelta = { totalHarvested: 0, totalEarned: 0 };
  for (const [id, farm] of Object.entries(state.farms)) {
    const storageGain: Record<string, number> = {};
    const plots = farm.plots.map(plot => {
      // Complete timed field actions
      if (plot.plotType === 'field' && plot.actionDurationTicks > 0) {
        const elapsed = tick - plot.actionStartTick;
        if (elapsed >= plot.actionDurationTicks) {
          const reset = { actionStartTick: 0, actionDurationTicks: 0 };
          if (plot.fieldState === 'being_tilled')
            return { ...plot, fieldState: 'tilled' as const, ...reset };
          if (plot.fieldState === 'being_planted')
            return { ...plot, fieldState: 'planted' as const, plantedAt: tick, ...reset };
          if (plot.fieldState === 'being_harvested' && plot.cropId) {
            const crop = CROPS[plot.cropId];
            if (crop) {
              storageGain[plot.cropId] = (storageGain[plot.cropId] ?? 0) + crop.yieldKg;
              statsDelta.totalHarvested += 1;
              events.fieldsHarvested += 1;
            }
            return { ...plot, fieldState: 'fallow' as const, cropId: null, plantedAt: 0, growthTicks: 0, ...reset };
          }
        }
      }
      // Crop growth
      if (plot.plotType === 'field' && plot.fieldState === 'planted') {
        if (tick - plot.plantedAt >= plot.growthTicks)
          return { ...plot, fieldState: 'ready' as const };
      }
      // Animal production (stallA + optional stallB)
      if (plot.plotType === 'stall') {
        const tickSlot = (slot: StallSlot): StallSlot => {
          if (!slot.animalId || slot.animalCount === 0) return slot;
          const animal = ANIMALS[slot.animalId];
          if (!animal) return slot;
          const maxAnimals   = getMaxAnimals(slot.animalId, plot.stallSize);
          const breedCycle   = getBreedingCycle(slot.animalId, plot.stallSize);
          let s = slot;
          // Statt einmal pro vollem Zyklus alles auf einen Schlag: Tiere produzieren laufend
          // in kleinen Schritten über den Tag verteilt (Rate = Tagesertrag / TICKS_PER_DAY),
          // gesammelt in einem gedeckelten Puffer. Ist der Puffer voll, pausiert die
          // Produktion, bis der Spieler manuell einlagert (collectStall) — genau das erzwingt
          // regelmäßiges Vorbeischauen statt eines einzigen Abholmoments pro Tag.
          if (!animal.noProductCycle) {
            const capacity = stallCapacity(slot.animalId, s.animalCount, plot.stallSize);
            if (s.outputReady < capacity) {
              const dailyYield = computeYield(slot.animalId, s.animalCount, plot.stallSize);
              const accum = s.productionAccum + dailyYield / TICKS_PER_DAY;
              const whole = Math.floor(accum);
              if (whole > 0) {
                const newReady = Math.min(capacity, s.outputReady + whole);
                if (s.outputReady === 0 && newReady > 0) events.stallCollectionsReady += 1;
                s = { ...s, outputReady: newReady, productionAccum: accum - whole };
              } else {
                s = { ...s, productionAccum: accum };
              }
            }
          }
          if (s.animalCount < maxAnimals && tick - s.lastBreedingAt >= breedCycle)
            s = { ...s, animalCount: s.animalCount + 1, lastBreedingAt: tick };
          return s;
        };
        const newA = tickSlot(plot.stallA);
        const newB = plot.stallB ? tickSlot(plot.stallB) : null;
        if (newA !== plot.stallA || newB !== plot.stallB)
          return { ...plot, stallA: newA, stallB: newB };
      }
      // Processing
      if (plot.plotType === 'processing') {
        let changed = false;
        const newSlots = plot.processingSlots.map(slot => {
          if (!slot.isProcessing) return slot;
          const b = PROCESSING_BUILDINGS[slot.buildingId];
          if (!b) return slot;
          if (tick - slot.cycleStartTick >= b.cycleSeconds) {
            changed = true;
            events.processingCompleted += 1;
            const output = slot.customOutputAmount ?? b.outputAmount;
            return { ...slot, isProcessing: false, outputReady: slot.outputReady + output, customOutputAmount: undefined };
          }
          return slot;
        });
        if (changed) return { ...plot, processingSlots: newSlots };
      }
      return plot;
    });
    const newStorage = { ...farm.storage };
    for (const [pid, amt] of Object.entries(storageGain))
      newStorage[pid] = (newStorage[pid] ?? 0) + amt;
    farms[id] = { ...farm, plots, storage: newStorage };
  }

  // Lieferungen: angekommene LKW-Fahrten ins Ziel-Lager einbuchen
  const pendingDeliveries: Delivery[] = [];
  for (const d of state.deliveries) {
    if (tick < d.arriveTick) { pendingDeliveries.push(d); continue; }
    const destFarm = farms[d.toFarmId];
    if (!destFarm) continue;
    farms[d.toFarmId] = {
      ...destFarm,
      storage: { ...destFarm.storage, [d.productId]: (destFarm.storage[d.productId] ?? 0) + d.amount },
    };
    events.deliveriesArrived.push({ productId: d.productId, amount: d.amount, fromFarmId: d.fromFarmId, toFarmId: d.toFarmId });
  }

  const dayChanged = day !== state.day; // 1 Spieltag = 1 echter Tag
  const wageSettlement = dayChanged ? settleDailyWages(state) : undefined;
  if (wageSettlement) {
    events.wagesPaid += wageSettlement.wagesPaid;
    wageSettlement.fired.forEach(e => events.employeesFired.push({ role: e.role, wage: e.wage }));
  }
  const priceUpdate = dayChanged ? advanceMarketPrices(state, day) : {};

  // `state.debt ?? 0` normalisiert Spielstände von vor der Einführung des Kreditsystems
  // (fehlendes Feld) auf 0, statt dass spätere Arithmetik zu NaN wird — debt wird deshalb
  // bewusst IMMER explizit zurückgegeben, nicht nur bei tatsächlicher Zinsänderung.
  const debtBefore = state.debt ?? 0;
  const interest = dayChanged && debtBefore > 0 ? Math.round(debtBefore * DEBT_INTEREST_RATE) : 0;
  if (interest > 0) events.interestAccrued += interest;

  return {
    state: {
      ...state, tick, day, season, year, farms,
      debt: debtBefore + interest,
      ...(wageSettlement ? { money: wageSettlement.money, employees: wageSettlement.employees } : {}),
      ...priceUpdate,
      deliveries: pendingDeliveries,
      stats: {
        totalHarvested: state.stats.totalHarvested + statsDelta.totalHarvested,
        totalEarned: state.stats.totalEarned + statsDelta.totalEarned,
      },
    },
    events,
  };
}

// ── Navigation ────────────────────────────────────────────────────────────────

export const setActiveFarm = (state: GameState, farmId: string): GameState =>
  ({ ...state, activeFarmId: farmId });

export function unlockFarm(state: GameState, farmId: string): GameState {
  const meta = state.farmMeta.find(m => m.id === farmId);
  if (!meta || meta.unlocked || state.money < meta.unlockCost) {
    bus.emit('notification', '💸 Nicht genug Geld!'); return state;
  }
  bus.emit('notification', `🎉 ${meta.name} in ${meta.city} freigeschaltet!`);
  return {
    ...state,
    farms: { ...state.farms, [farmId]: makeFarm() },
    farmMeta: state.farmMeta.map(m => m.id === farmId ? { ...m, unlocked: true } : m),
    money: state.money - meta.unlockCost,
    activeFarmId: farmId,
  };
}

// Erzeugt eine eindeutige, URL-/Key-sichere ID aus einem Stadtnamen — genutzt sowohl
// beim Eröffnen weiterer Standorte (unten) als auch beim frei wählbaren Startort
// (server/src/routes/game.ts POST /start).
export function slugifyCityId(city: string): string {
  return city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
}

export function openNewFarm(state: GameState, city: string, farmName: string, lat: number, lon: number, cost: number): GameState {
  if (state.money < cost) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const id = slugifyCityId(city);
  const newMeta = { id, name: farmName, city, unlocked: true, unlockCost: cost, lat, lon };
  bus.emit('notification', `🎉 ${farmName} in ${city} eröffnet!`);
  return {
    ...state,
    farms: { ...state.farms, [id]: makeFarm() },
    farmMeta: [...state.farmMeta, newMeta],
    money: state.money - cost,
    activeFarmId: id,
  };
}

// ── Plot purchase ─────────────────────────────────────────────────────────────

export function buyPlot(state: GameState, farmId: string, plotId: number): GameState {
  const farm = state.farms[farmId];
  if (!farm) return state;
  const plot = farm.plots.find(p => p.id === plotId);
  if (!plot || !plot.locked) return state;
  if (state.money < plot.unlockCost) { bus.emit('notification','💸 Nicht genug Geld!'); return state; }
  bus.emit('notification', `✅ Parzelle ${plotId + 1} gekauft`);
  return { ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, { locked: false }) }),
           money: state.money - plot.unlockCost };
}

// ── Field operations ──────────────────────────────────────────────────────────

function findFreeTractor(state: GameState, farmId: string) {
  return state.vehicles.find(v => v.farmId === farmId && v.defId === 'traktor' && v.inUseUntilTick <= state.tick);
}

function findFreeImpl(state: GameState, farmId: string, task: string) {
  return state.implements.find(i => i.farmId === farmId && IMPLEMENTS[i.defId]?.task === task && i.inUseUntilTick <= state.tick);
}

function markInUse(state: GameState, vehicleUid: number, implementUid: number, durationTicks: number): Pick<GameState, 'vehicles' | 'implements'> {
  const until = state.tick + durationTicks;
  return {
    vehicles:   state.vehicles.map(v => v.uid === vehicleUid   ? { ...v, inUseUntilTick: until } : v),
    implements: state.implements.map(i => i.uid === implementUid ? { ...i, inUseUntilTick: until, pairedVehicleUid: vehicleUid } : i),
  };
}

// ── Personal ──────────────────────────────────────────────────────────────────

export function findFreeEmployee(state: GameState, farmId: string, role: EmployeeRole): Employee | undefined {
  return state.employees.find(e => e.farmId === farmId && e.role === role && e.inUseUntilTick <= state.tick);
}

function markEmployeeInUse(state: GameState, uid: number, durationTicks: number): Pick<GameState, 'employees'> {
  const until = state.tick + durationTicks;
  return { employees: state.employees.map(e => e.uid === uid ? { ...e, inUseUntilTick: until } : e) };
}

export function hireEmployee(state: GameState, farmId: string, role: EmployeeRole): GameState {
  const def = EMPLOYEE_ROLES[role];
  const meta = state.farmMeta.find(m => m.id === farmId);
  if (!def || !meta) return state;
  if (state.money < def.hireCost) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const employee: Employee = { uid: state.nextEmployeeUid, role, farmId, wage: def.wagePerDay, inUseUntilTick: 0 };
  bus.emit('notification', `${def.emoji} ${def.name} in ${meta.city} eingestellt`);
  return {
    ...state,
    employees: [...state.employees, employee],
    money: state.money - def.hireCost,
    nextEmployeeUid: state.nextEmployeeUid + 1,
  };
}

export function moveEmployee(state: GameState, uid: number, targetFarmId: string): GameState {
  const meta = state.farmMeta.find(m => m.id === targetFarmId);
  const e = state.employees.find(e => e.uid === uid);
  if (!meta || !e) return state;
  const def = EMPLOYEE_ROLES[e.role];
  bus.emit('notification', `${def?.emoji ?? '👤'} ${def?.name ?? 'Mitarbeiter'} → ${meta.city} versetzt`);
  return { ...state, employees: state.employees.map(x => x.uid === uid ? { ...x, farmId: targetFarmId } : x) };
}

export function fireEmployee(state: GameState, uid: number): GameState {
  const e = state.employees.find(e => e.uid === uid);
  if (!e) return state;
  const def = EMPLOYEE_ROLES[e.role];
  bus.emit('notification', `${def?.emoji ?? '👤'} ${def?.name ?? 'Mitarbeiter'} gekündigt`);
  return { ...state, employees: state.employees.filter(x => x.uid !== uid) };
}

export function dailyPayroll(employees: Employee[]): number {
  return employees.reduce((s, e) => s + e.wage, 0);
}

// Tägliche Lohnzahlung: reicht das Geld nicht für alle Löhne, kündigen die teuersten Mitarbeiter
// zuerst von selbst, bis der Rest bezahlbar ist — der Kontostand rutscht dadurch nie ins Minus.
interface WageSettlement { money: number; employees: Employee[]; wagesPaid: number; fired: Employee[]; }

// Notification-frei (wird vom Aufrufer anhand der TickEvents ausgelöst — live sofort,
// beim Offline-Nachholen gesammelt), damit tausende nachgeholte Ticks nicht spammen.
function settleDailyWages(state: GameState): WageSettlement {
  const payroll = dailyPayroll(state.employees);
  if (payroll <= state.money) {
    return { money: state.money - payroll, employees: state.employees, wagesPaid: payroll, fired: [] };
  }
  const remaining = [...state.employees].sort((a, b) => b.wage - a.wage);
  const fired: Employee[] = [];
  while (remaining.length > 0 && dailyPayroll(remaining) > state.money) {
    fired.push(remaining.shift()!);
  }
  const finalPayroll = dailyPayroll(remaining);
  return {
    money: Math.max(0, state.money - finalPayroll),
    employees: state.employees.filter(e => remaining.some(r => r.uid === e.uid)),
    wagesPaid: finalPayroll,
    fired,
  };
}

// Marks a parcel as a permanent field (no equipment needed — just land-use designation).
export function designateField(state: GameState, farmId: string, plotId: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.locked || plot.plotType !== 'field' || plot.fieldState !== 'empty') return state;
  return updateFarm(state, farmId, { plots: updPlot(farm, plotId, { fieldState: 'fallow' }) });
}

// Starts tilling a fallow field (requires tractor + pflug). Completes after FIELD_WORK_TICKS.
export function tillPlot(state: GameState, farmId: string, plotId: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.locked || plot.plotType !== 'field' || plot.fieldState !== 'fallow') return state;

  const tractor = findFreeTractor(state, farmId);
  const pflug   = findFreeImpl(state, farmId, 'till');
  const farmer  = findFreeEmployee(state, farmId, 'farmer');
  if (!tractor) { bus.emit('notification', '🚜 Kein freier Traktor am Standort — kaufe einen im Fahrzeug-Shop'); return state; }
  if (!pflug)   { bus.emit('notification', '⛏️ Kein freier Pflug am Standort — kaufe ein Anbaugerät im Shop'); return state; }
  if (!farmer)  { bus.emit('notification', '👨‍🌾 Kein freier Farmer am Standort — stelle einen im Personal-Menü ein'); return state; }

  bus.emit('notification', '⛏️ Pflügen gestartet…');
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_tilled',
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    }) }),
    ...markInUse(state, tractor.uid, pflug.uid, FIELD_WORK_TICKS),
    ...markEmployeeInUse(state, farmer.uid, FIELD_WORK_TICKS),
  };
}

// Starts planting a crop (requires tractor + sämaschine). Completes after FIELD_WORK_TICKS.
export function plantCrop(state: GameState, farmId: string, plotId: number, cropId: string): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  const crop = CROPS[cropId];
  if (!plot || plot.locked || plot.plotType !== 'field' || plot.fieldState !== 'tilled' || !crop) return state;
  if (state.money < crop.seedCost) { bus.emit('notification','💸 Nicht genug Geld für Saatgut!'); return state; }

  const tractor = findFreeTractor(state, farmId);
  const saem    = findFreeImpl(state, farmId, 'plant');
  const farmer  = findFreeEmployee(state, farmId, 'farmer');
  if (!tractor) { bus.emit('notification', '🚜 Kein freier Traktor am Standort — kaufe einen im Fahrzeug-Shop'); return state; }
  if (!saem)    { bus.emit('notification', '🌱 Keine freie Sämaschine am Standort — kaufe ein Anbaugerät im Shop'); return state; }
  if (!farmer)  { bus.emit('notification', '👨‍🌾 Kein freier Farmer am Standort — stelle einen im Personal-Menü ein'); return state; }

  bus.emit('notification', `🌱 ${crop.name} wird gesät…`);
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_planted', cropId,
      growthTicks: crop.growthTicks, plantedAt: 0,
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    })}),
    money: state.money - crop.seedCost,
    ...markInUse(state, tractor.uid, saem.uid, FIELD_WORK_TICKS),
    ...markEmployeeInUse(state, farmer.uid, FIELD_WORK_TICKS),
  };
}

// Starts harvesting a ready field (requires free tractor or mähdrescher). Completes after FIELD_WORK_TICKS.
export function harvestPlot(state: GameState, farmId: string, plotId: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'field' || plot.fieldState !== 'ready' || !plot.cropId) return state;
  const crop = CROPS[plot.cropId];
  if (!crop) return state;

  const harvester = state.vehicles.find(v =>
    v.farmId === farmId && v.inUseUntilTick <= state.tick &&
    (v.defId === 'traktor' || v.defId === 'maehdrescher')
  );
  const farmer = findFreeEmployee(state, farmId, 'farmer');
  if (!harvester) { bus.emit('notification', '🚜 Kein freies Fahrzeug zum Ernten — Traktor oder Mähdrescher nötig'); return state; }
  if (!farmer)    { bus.emit('notification', '👨‍🌾 Kein freier Farmer am Standort — stelle einen im Personal-Menü ein'); return state; }

  bus.emit('notification', `🌾 ${crop.name} wird geerntet…`);
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_harvested',
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    }) }),
    vehicles: state.vehicles.map(v =>
      v.uid === harvester.uid ? { ...v, inUseUntilTick: state.tick + FIELD_WORK_TICKS } : v
    ),
    ...markEmployeeInUse(state, farmer.uid, FIELD_WORK_TICKS),
  };
}

// ── Stall operations ──────────────────────────────────────────────────────────

export function buildStall(state: GameState, farmId: string, plotId: number, animalId: string, size: StallSize): GameState {
  const farm   = state.farms[farmId];
  const plot   = farm?.plots.find(p => p.id === plotId);
  const animal = ANIMALS[animalId];
  if (!plot || plot.locked || !animal) return state;
  const cost = size === 'full' ? animal.buildCostFull : animal.buildCostHalf;
  if (state.money < cost) { bus.emit('notification','💸 Nicht genug Geld!'); return state; }
  const sizeLabel = size === 'full' ? '0,1 ha' : '0,05 ha';
  const starting = getStartingAnimals(animalId, size);
  bus.emit('notification', `🏗️ ${animal.name}-Stall (${sizeLabel}) gebaut – ${starting} Tier(e) dabei`);
  const slotA: StallSlot = { animalId, animalCount: starting,
    outputReady: 0, productionAccum: 0, lastCollectedAt: state.tick, lastBreedingAt: state.tick };
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      plotType: 'stall', stallSize: size,
      stallA: slotA, stallB: null,
      fieldState: 'empty', cropId: null,
    })}),
    money: state.money - cost,
  };
}

// slot: 0 = stallA, 1 = stallB
export function collectStall(state: GameState, farmId: string, plotId: number, slot: 0 | 1 = 0): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'stall') return state;
  const stallSlot = slot === 0 ? plot.stallA : plot.stallB;
  if (!stallSlot?.animalId || !(stallSlot.outputReady > 0)) return state;
  const animal = ANIMALS[stallSlot.animalId];
  if (!animal) return state;
  const yield_ = stallSlot.outputReady;
  bus.emit('notification', `🧺 ${yield_} ${animal.productEmoji} ${animal.productName} eingelagert`);
  const newSlot: StallSlot = { ...stallSlot, outputReady: 0, lastCollectedAt: state.tick };
  const newStorage = { ...farm.storage, [animal.productId]: (farm.storage[animal.productId] ?? 0) + yield_ };
  return updateFarm(state, farmId, {
    plots: updPlot(farm, plotId, slot === 0 ? { stallA: newSlot } : { stallB: newSlot }),
    storage: newStorage,
  });
}

export function buyAnimal(state: GameState, farmId: string, plotId: number, slot: 0 | 1 = 0): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'stall') return state;
  const stallSlot = slot === 0 ? plot.stallA : plot.stallB;
  if (!stallSlot?.animalId) return state;
  const animal = ANIMALS[stallSlot.animalId];
  if (!animal) return state;
  const maxAnimals = getMaxAnimals(stallSlot.animalId, plot.stallSize);
  const buyCost    = getBuyCost(stallSlot.animalId, plot.stallSize);
  if (stallSlot.animalCount >= maxAnimals) {
    bus.emit('notification', `❌ Stall voll (max. ${maxAnimals} Tiere)`); return state;
  }
  if (state.money < buyCost) {
    bus.emit('notification', '💸 Nicht genug Geld!'); return state;
  }
  bus.emit('notification', `🐾 ${animal.emoji} 1 ${animal.name.slice(0,-1)} gekauft`);
  const newSlot = { ...stallSlot, animalCount: stallSlot.animalCount + 1 };
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, slot === 0 ? { stallA: newSlot } : { stallB: newSlot }) }),
    money: state.money - buyCost,
  };
}

export function buildSecondHalfStall(state: GameState, farmId: string, plotId: number, animalId: string): GameState {
  const farm   = state.farms[farmId];
  const plot   = farm?.plots.find(p => p.id === plotId);
  const animal = ANIMALS[animalId];
  if (!plot || plot.plotType !== 'stall' || plot.stallSize !== 'half' || plot.stallB !== null || !animal) return state;
  const cost = animal.buildCostHalf;
  if (state.money < cost) { bus.emit('notification','💸 Nicht genug Geld!'); return state; }
  const starting = getStartingAnimals(animalId, 'half');
  bus.emit('notification', `🏗️ ${animal.name}-Stall (zweite Hälfte) – ${starting} Tier(e) dabei`);
  const newB: StallSlot = { animalId, animalCount: starting,
    outputReady: 0, productionAccum: 0, lastCollectedAt: state.tick, lastBreedingAt: state.tick };
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, { stallB: newB }) }),
    money: state.money - cost,
  };
}

export function demolishPlot(state: GameState, farmId: string, plotId: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.locked) return state;
  bus.emit('notification', `🔨 Parzelle ${plotId + 1} zurückgebaut`);
  return updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
    plotType: 'field', fieldState: 'empty', cropId: null, plantedAt: 0, growthTicks: 0,
    actionStartTick: 0, actionDurationTicks: 0,
    stallSize: 'full', stallA: emptyStallSlot(), stallB: null,
    processingSlots: [],
  })});
}

// ── Processing ────────────────────────────────────────────────────────────────

export function buildProcessingBuilding(state: GameState, farmId: string, plotId: number, buildingId: string): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.locked) return state;
  const building = PROCESSING_BUILDINGS[buildingId];
  if (!building) return state;
  if (state.money < building.buildCost) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const currentSlots = plot.plotType === 'processing' ? plot.processingSlots : [];
  const needed = processingSpaceUnits(building.size);
  if (usedSpaceUnits(currentSlots) + needed > PLOT_TOTAL_UNITS) {
    bus.emit('notification', '❌ Kein Platz auf der Parzelle!'); return state;
  }
  const newSlot: ProcessingSlot = {
    buildingId, size: building.size,
    isProcessing: false, cycleStartTick: 0, outputReady: 0,
    slaughterTarget:  building.inputFromStall ? 1       : undefined,
    slaughterAnimalId: building.inputFromStall ? 'pig'  : undefined,
  };
  bus.emit('notification', `🏗️ ${building.name} gebaut`);
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      plotType: 'processing',
      processingSlots: [...currentSlots, newSlot],
      fieldState: 'empty', cropId: null,
    })}),
    money: state.money - building.buildCost,
  };
}

export function loadProcessing(state: GameState, farmId: string, plotId: number, slotIdx: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'processing') return state;
  const slot = plot.processingSlots[slotIdx];
  if (!slot || slot.isProcessing) return state;
  const building = PROCESSING_BUILDINGS[slot.buildingId];
  if (!building) return state;

  // ── Schlachthof: Input kommt direkt aus Ställen ──
  if (building.inputFromStall) {
    const animalId = building.inputFromStall === 'any'
      ? (slot.slaughterAnimalId ?? 'pig')
      : building.inputFromStall;
    const animal = ANIMALS[animalId];
    const kgPerAnimal = animal?.slaughterKgPerAnimal ?? 1;
    const outputProductId = animal?.slaughterProductId ?? '';
    const target = slot.slaughterTarget ?? 1;
    // Tiere in allen Ställen dieses Standorts zählen
    let available = 0;
    for (const p of farm.plots) {
      if (p.plotType !== 'stall') continue;
      if (p.stallA.animalId === animalId) available += p.stallA.animalCount;
      if (p.stallB?.animalId === animalId) available += p.stallB.animalCount;
    }
    const taken = Math.min(target, available);
    if (taken === 0) {
      bus.emit('notification', `❌ Keine ${ANIMALS[animalId]?.name ?? 'Tiere'} im Stall`);
      return state;
    }
    // Tiere aus Ställen abziehen
    let remaining = taken;
    const updatedPlots = farm.plots.map(p => {
      if (remaining <= 0 || p.plotType !== 'stall') return p;
      const drain = (s: StallSlot): StallSlot => {
        if (s.animalId !== animalId || remaining <= 0) return s;
        const take = Math.min(remaining, s.animalCount);
        remaining -= take;
        return { ...s, animalCount: s.animalCount - take };
      };
      return { ...p, stallA: drain(p.stallA), stallB: p.stallB ? drain(p.stallB) : null };
    });
    const customOutputAmount = taken * kgPerAnimal;
    const finalPlots = updatedPlots.map(p => {
      if (p.id !== plotId) return p;
      return { ...p, processingSlots: p.processingSlots.map((s, i) =>
        i === slotIdx ? { ...s, isProcessing: true, cycleStartTick: state.tick, customOutputAmount, slaughterAnimalId: animalId } : s
      )};
    });
    bus.emit('notification', `🔪 ${building.name} gestartet – ${taken} ${animal?.name ?? 'Tiere'}`);
    return updateFarm(state, farmId, { plots: finalPlots });
  }

  // ── Standard-Verarbeitung: Input aus Lager ──
  const stored = farm.storage[building.inputProductId] ?? 0;
  if (stored < building.inputAmount) {
    const prod = PRODUCTS[building.inputProductId];
    bus.emit('notification', `❌ Zu wenig ${prod?.name ?? building.inputProductId} im Lager`);
    return state;
  }
  const newStorage = { ...farm.storage, [building.inputProductId]: stored - building.inputAmount };
  const newSlots = plot.processingSlots.map((s, i) =>
    i === slotIdx ? { ...s, isProcessing: true, cycleStartTick: state.tick } : s
  );
  bus.emit('notification', `⚙️ ${building.name} gestartet`);
  return updateFarm(state, farmId, {
    plots: updPlot(farm, plotId, { processingSlots: newSlots }),
    storage: newStorage,
  });
}

export function setSlaughterAnimal(state: GameState, farmId: string, plotId: number, slotIdx: number, animalId: string): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'processing') return state;
  const slot = plot.processingSlots[slotIdx];
  if (!slot || slot.isProcessing) return state;
  const newSlots = plot.processingSlots.map((s, i) =>
    i === slotIdx ? { ...s, slaughterAnimalId: animalId } : s
  );
  return updateFarm(state, farmId, { plots: updPlot(farm, plotId, { processingSlots: newSlots }) });
}

export function setSlaughterTarget(state: GameState, farmId: string, plotId: number, slotIdx: number, target: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'processing') return state;
  const newSlots = plot.processingSlots.map((s, i) =>
    i === slotIdx ? { ...s, slaughterTarget: Math.max(1, target) } : s
  );
  return updateFarm(state, farmId, { plots: updPlot(farm, plotId, { processingSlots: newSlots }) });
}

export function countFarmAnimals(farm: FarmLocation, animalId: string): number {
  let total = 0;
  for (const p of farm.plots) {
    if (p.plotType !== 'stall') continue;
    if (p.stallA.animalId === animalId) total += p.stallA.animalCount;
    if (p.stallB?.animalId === animalId) total += p.stallB.animalCount;
  }
  return total;
}

export function collectProcessingOutput(state: GameState, farmId: string, plotId: number, slotIdx: number): GameState {
  const farm = state.farms[farmId];
  const plot = farm?.plots.find(p => p.id === plotId);
  if (!plot || plot.plotType !== 'processing') return state;
  const slot = plot.processingSlots[slotIdx];
  if (!slot || slot.outputReady <= 0) return state;
  const building = PROCESSING_BUILDINGS[slot.buildingId];
  if (!building) return state;
  // Schlachthof: Produkt dynamisch aus der Tierart ermitteln
  const outputProductId = building.inputFromStall === 'any' && slot.slaughterAnimalId
    ? (ANIMALS[slot.slaughterAnimalId]?.slaughterProductId ?? building.outputProductId)
    : building.outputProductId;
  const prod = PRODUCTS[outputProductId];
  const amount = slot.outputReady;
  bus.emit('notification', `📦 ${amount} ${prod?.unit ?? ''} ${prod?.name ?? ''} eingelagert`);
  const newStorage = {
    ...farm.storage,
    [outputProductId]: (farm.storage[outputProductId] ?? 0) + amount,
  };
  const newSlots = plot.processingSlots.map((s, i) => i === slotIdx ? { ...s, outputReady: 0 } : s);
  return {
    ...updateFarm(state, farmId, {
      plots: updPlot(farm, plotId, { processingSlots: newSlots }),
      storage: newStorage,
    }),
    stats: { ...state.stats, totalEarned: state.stats.totalEarned },
  };
}

export function procProgress(slot: ProcessingSlot, currentTick: number): number {
  if (!slot.isProcessing) return 0;
  const building = PROCESSING_BUILDINGS[slot.buildingId];
  if (!building) return 0;
  return Math.min(1, (currentTick - slot.cycleStartTick) / building.cycleSeconds);
}

// ── Selling ───────────────────────────────────────────────────────────────────

export function sellToMerchant(state: GameState, farmId: string, productId: string, amount: number, pricePerUnit: number): GameState {
  const farm = state.farms[farmId];
  if (!farm) return state;
  const stored = farm.storage[productId] ?? 0;
  const actual = Math.min(amount, stored);
  if (actual <= 0) return state;
  const prod = PRODUCTS[productId];
  if (!prod) return state;
  const earned = Math.round(actual * pricePerUnit);
  const amtLabel = actual >= 1000 && prod.unit === 'kg' ? (actual/1000).toFixed(1)+'t' : `${actual} ${prod.unit}`;
  bus.emit('notification', `💰 ${amtLabel} ${prod.name} → ${earned.toLocaleString('de-DE')} €`);
  return {
    ...updateFarm(state, farmId, { storage: { ...farm.storage, [productId]: stored - actual } }),
    money: state.money + earned,
    stats: { ...state.stats, totalEarned: state.stats.totalEarned + earned },
  };
}

// ── Hofladen (Direktvermarktung) ────────────────────────────────────────────

export function unlockHofladen(state: GameState, farmId: string): GameState {
  const farm = state.farms[farmId];
  if (!farm || state.hofladen[farmId]?.unlocked) return state;
  bus.emit('notification', '🏪 Hofladen eröffnet!');
  return {
    ...state,
    hofladen: { ...state.hofladen, [farmId]: { unlocked: true, offers: [] } },
  };
}

// Preis wird serverseitig gedeckelt (max 1.8× Basispreis) statt dem Client zu vertrauen —
// dieselbe Grenze, die FarmUI schon vor dem Absenden prüft, aber hier verbindlich.
// Setzt/ändert nur den Preis — der Warenbestand wird separat per stockHofladen() eingelagert.
export function setHofladenOffer(
  state: GameState, farmId: string, productId: string, pricePerUnit: number,
): GameState {
  const config = state.hofladen[farmId];
  if (!config?.unlocked || !PRODUCTS[productId] || !(pricePerUnit > 0)) return state;

  const maxPrice = (currentPrice(state, productId) || 1) * 1.8;
  const existingIdx = config.offers.findIndex(o => o.productId === productId);
  const offer = {
    productId,
    pricePerUnit: Math.min(pricePerUnit, maxPrice),
    stock: existingIdx >= 0 ? config.offers[existingIdx].stock : 0,
  };
  const offers = existingIdx >= 0
    ? config.offers.map((o, i) => i === existingIdx ? offer : o)
    : [...config.offers, offer];

  return { ...state, hofladen: { ...state.hofladen, [farmId]: { ...config, offers } } };
}

// Verschiebt Ware vom Farm-Lager in den Hofladen — erst danach kann sie dort verkauft werden.
export function stockHofladen(state: GameState, farmId: string, productId: string, amount: number): GameState {
  const farm = state.farms[farmId];
  const config = state.hofladen[farmId];
  if (!farm || !config?.unlocked || !(amount > 0)) return state;
  const offerIdx = config.offers.findIndex(o => o.productId === productId);
  if (offerIdx < 0) { bus.emit('notification', '❌ Erst Preis setzen'); return state; }

  const stored = farm.storage[productId] ?? 0;
  const actual = Math.min(amount, stored);
  if (actual <= 0) return state;

  const offers = config.offers.map((o, i) => i === offerIdx ? { ...o, stock: o.stock + actual } : o);
  return {
    ...updateFarm(state, farmId, { storage: { ...farm.storage, [productId]: stored - actual } }),
    hofladen: { ...state.hofladen, [farmId]: { ...config, offers } },
  };
}

// Umkehrung von stockHofladen — Ware zurück ins Farm-Lager holen.
export function unstockHofladen(state: GameState, farmId: string, productId: string, amount: number): GameState {
  const farm = state.farms[farmId];
  const config = state.hofladen[farmId];
  if (!farm || !config || !(amount > 0)) return state;
  const offerIdx = config.offers.findIndex(o => o.productId === productId);
  if (offerIdx < 0) return state;

  const offer = config.offers[offerIdx];
  const actual = Math.min(amount, offer.stock);
  if (actual <= 0) return state;

  const offers = config.offers.map((o, i) => i === offerIdx ? { ...o, stock: o.stock - actual } : o);
  const stored = farm.storage[productId] ?? 0;
  return {
    ...updateFarm(state, farmId, { storage: { ...farm.storage, [productId]: stored + actual } }),
    hofladen: { ...state.hofladen, [farmId]: { ...config, offers } },
  };
}

export function removeHofladenOffer(state: GameState, farmId: string, index: number): GameState {
  const farm = state.farms[farmId];
  const config = state.hofladen[farmId];
  if (!farm || !config) return state;
  const offer = config.offers[index];
  if (!offer) return state;

  // Eingelagerte Ware geht beim Entfernen nicht verloren, sondern geht zurück ins Farm-Lager.
  const stored = farm.storage[offer.productId] ?? 0;
  return {
    ...updateFarm(state, farmId, { storage: { ...farm.storage, [offer.productId]: stored + offer.stock } }),
    hofladen: { ...state.hofladen, [farmId]: { ...config, offers: config.offers.filter((_, i) => i !== index) } },
  };
}

export function sellFromStorage(state: GameState, farmId: string, productId: string, amount: number): GameState {
  const farm = state.farms[farmId];
  if (!farm) return state;
  const stored = farm.storage[productId] ?? 0;
  const actual = Math.min(amount, stored);
  if (actual <= 0) return state;
  const product = PRODUCTS[productId];
  if (!product) return state;
  const earned = Math.round(actual * currentPrice(state, productId));
  const amtLabel = actual >= 1000 && product.unit === 'kg'
    ? (actual/1000).toFixed(1)+'t'
    : `${actual} ${product.unit}`;
  bus.emit('notification', `💰 ${amtLabel} ${product.name} → ${earned.toLocaleString('de-DE')} €`);
  return {
    ...updateFarm(state, farmId, { storage: { ...farm.storage, [productId]: stored - actual } }),
    money: state.money + earned,
    stats: { ...state.stats, totalEarned: state.stats.totalEarned + earned },
  };
}

// ── Kredit ───────────────────────────────────────────────────────────────────

export function takeLoan(state: GameState, amount: number): GameState {
  if (!(amount > 0)) return state;
  const debt = state.debt ?? 0;
  const available = MAX_DEBT - debt;
  if (available <= 0) { bus.emit('notification', '🏦 Kreditlimit erreicht'); return state; }
  const actual = Math.min(amount, available);
  bus.emit('notification', `🏦 ${actual.toLocaleString('de-DE')} € Kredit aufgenommen`);
  return { ...state, money: state.money + actual, debt: debt + actual };
}

export function repayLoan(state: GameState, amount: number): GameState {
  if (!(amount > 0)) return state;
  const debt = state.debt ?? 0;
  const actual = Math.min(amount, debt, state.money);
  if (actual <= 0) { bus.emit('notification', '💸 Nicht genug Geld oder kein offener Kredit'); return state; }
  bus.emit('notification', `🏦 ${actual.toLocaleString('de-DE')} € Kredit zurückgezahlt`);
  return { ...state, money: state.money - actual, debt: debt - actual };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function growthProgress(plot: Plot, currentTick: number): number {
  if (plot.plotType !== 'field' || plot.fieldState !== 'planted' || plot.growthTicks === 0) return 0;
  return Math.min(1, (currentTick - plot.plantedAt) / plot.growthTicks);
}

// Füllstand des Stall-Puffers relativ zur Kapazität (0 = leer, 1 = voll/pausiert).
// Zählt productionAccum (den noch unfertigen Bruchteil des nächsten Eis/L Milch/…)
// mit ein, damit der Balken laufend wächst statt nur in Sprüngen bei jeder ganzen
// Einheit — sonst wirkt die Anzeige zwischen zwei Einheiten wie eingefroren.
export function slotProgress(slot: StallSlot, stallSize: StallSize): number {
  if (!slot.animalId || slot.animalCount === 0) return 0;
  const animal = ANIMALS[slot.animalId];
  if (!animal || animal.noProductCycle) return 0;
  const capacity = stallCapacity(slot.animalId, slot.animalCount, stallSize);
  if (capacity <= 0) return 0;
  return Math.min(1, (slot.outputReady + slot.productionAccum) / capacity);
}

export function slotBreedProgress(slot: StallSlot, stallSize: 'full' | 'half', currentTick: number): number {
  if (!slot.animalId) return 0;
  const maxAnimals  = getMaxAnimals(slot.animalId, stallSize);
  const breedCycle  = getBreedingCycle(slot.animalId, stallSize);
  if (slot.animalCount >= maxAnimals) return 1;
  return Math.min(1, (currentTick - slot.lastBreedingAt) / breedCycle);
}

export function farmReadyCount(farm: FarmLocation): number {
  return farm.plots.filter(p => {
    if (p.locked) return false;
    if (p.plotType === 'field') return p.fieldState === 'ready';
    if (p.plotType === 'stall') return p.stallA.outputReady > 0 || (p.stallB?.outputReady ?? 0) > 0;
    if (p.plotType === 'processing') return p.processingSlots.some(s => s.outputReady > 0);
    return false;
  }).length;
}

export function nextBuyablePlot(farm: FarmLocation): Plot | null {
  return farm.plots.find(p => p.locked) ?? null;
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

export function buyVehicle(state: GameState, defId: string, farmId: string): GameState {
  const def  = VEHICLES[defId];
  const meta = state.farmMeta.find(m => m.id === farmId);
  if (!def || !meta) return state;
  if (state.money < def.price) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const vehicle: OwnedVehicle = { uid: state.nextVehicleUid, defId, farmId, inUseUntilTick: 0 };
  bus.emit('notification', `🚜 ${def.name} → ${meta.city} geliefert`);
  return {
    ...state,
    money: state.money - def.price,
    vehicles: [...state.vehicles, vehicle],
    nextVehicleUid: state.nextVehicleUid + 1,
  };
}

export function moveVehicle(state: GameState, uid: number, targetFarmId: string): GameState {
  const meta = state.farmMeta.find(m => m.id === targetFarmId);
  if (!meta) return state;
  const v = state.vehicles.find(v => v.uid === uid);
  if (!v) return state;
  const def = VEHICLES[v.defId];
  bus.emit('notification', `🚜 ${def?.name ?? 'Fahrzeug'} → ${meta.city} umstationiert`);
  return { ...state, vehicles: state.vehicles.map(v => v.uid === uid ? { ...v, farmId: targetFarmId } : v) };
}

// ── Implements ────────────────────────────────────────────────────────────────

export function buyImplement(state: GameState, defId: string, farmId: string): GameState {
  const def  = IMPLEMENTS[defId];
  const meta = state.farmMeta.find(m => m.id === farmId);
  if (!def || !meta) return state;
  if (state.money < def.price) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const impl: OwnedImplement = {
    uid: state.nextVehicleUid, defId, farmId,
    inUseUntilTick: 0, pairedVehicleUid: null,
  };
  bus.emit('notification', `🔧 ${def.name} → ${meta.city} geliefert`);
  return {
    ...state,
    money: state.money - def.price,
    implements: [...state.implements, impl],
    nextVehicleUid: state.nextVehicleUid + 1,
  };
}

export function moveImplement(state: GameState, uid: number, targetFarmId: string): GameState {
  const meta = state.farmMeta.find(m => m.id === targetFarmId);
  if (!meta) return state;
  const impl = state.implements.find(i => i.uid === uid);
  if (!impl) return state;
  const def = IMPLEMENTS[impl.defId];
  bus.emit('notification', `🔧 ${def?.name ?? 'Gerät'} → ${meta.city} umstationiert`);
  return { ...state, implements: state.implements.map(i => i.uid === uid ? { ...i, farmId: targetFarmId } : i) };
}

// Helper: is there a free tractor + implement of given task at this farm?
export function hasFreePair(state: GameState, farmId: string, task: string): boolean {
  const freeTractor = state.vehicles.some(
    v => v.farmId === farmId && v.defId === 'traktor' && v.inUseUntilTick <= state.tick
  );
  const freeImpl = state.implements.some(
    i => i.farmId === farmId && IMPLEMENTS[i.defId]?.task === task && i.inUseUntilTick <= state.tick
  );
  return freeTractor && freeImpl;
}

export function countFreeImplements(state: GameState, farmId: string, task: string): number {
  return state.implements.filter(
    i => i.farmId === farmId && IMPLEMENTS[i.defId]?.task === task && i.inUseUntilTick <= state.tick
  ).length;
}

// Wendet gewonnene Markt-Gebote/Hofladen-Verkäufe (server-seitig in market_credits
// gesammelt, siehe server/src/market/matching.ts) auf einen Spielstand an: Geld gutschreiben,
// verkaufte Ware aus dem Lager abziehen. Reine State-Logik, deshalb hier statt in api.ts —
// so kann sowohl der Server (beim Laden/Fortschreiben eines Standes) als auch der Client
// (für optimistisches Rendering) dieselbe Funktion nutzen.
export function applyMarketCredits(state: GameState, credits: MarketCredit[]): GameState {
  let s = state;
  for (const credit of credits) {
    s = { ...s, money: s.money + credit.amountEur };
    for (const change of credit.productChanges) {
      const farm = s.farms[change.farmId];
      if (!farm) continue;
      const current = farm.storage[change.productId] ?? 0;
      const newAmt   = Math.max(0, current + change.amount);
      s = {
        ...s,
        farms: {
          ...s.farms,
          [change.farmId]: {
            ...farm,
            storage: { ...farm.storage, [change.productId]: newAmt },
          },
        },
      };
    }
  }
  return s;
}
