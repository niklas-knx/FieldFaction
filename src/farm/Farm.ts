import type { GameState, FarmLocation, Plot, StallSlot, Season, StallSize, ProcessingSlot, OwnedVehicle, OwnedImplement } from '../types';
import { VEHICLES } from '../data/vehicles';
import { IMPLEMENTS } from '../data/implements';
import { CROPS } from '../data/crops';
import { ANIMALS, computeYield, getMaxAnimals, getBuyCost, getBreedingCycle, getStartingAnimals } from '../data/animals';
import { PROCESSING_BUILDINGS, processingSpaceUnits, usedSpaceUnits, PLOT_TOTAL_UNITS } from '../data/processing';
import { FARM_META } from '../data/farmLocations';
import { PRODUCTS } from '../data/products';
import { bus } from '../core/EventBus';

export const TICKS_PER_DAY     = 24;
export const DAYS_PER_SEASON   = 28;
export const MAX_PLOTS         = 12;
export const FIELD_WORK_TICKS  = 900; // 15 Minuten Traktorarbeit pro Parzelle

export const PLOT_UNLOCK_COSTS = [0,0,0, 200,400,800, 1500,3000,5000, 8000,12000,18000];

const SEASONS: Season[] = ['spring','summer','autumn','winter'];
const SEASON_NAMES: Record<Season,string> = {
  spring:'Frühling', summer:'Sommer', autumn:'Herbst', winter:'Winter',
};
export const seasonName = (s: Season) => SEASON_NAMES[s];

function emptyStallSlot(tick = 0): StallSlot {
  return { animalId: null, animalCount: 0, productionReady: false, lastCollectedAt: tick, lastBreedingAt: tick };
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

export function createInitialState(): GameState {
  const farms: Record<string, FarmLocation> = {};
  FARM_META.forEach(m => { if (m.unlocked) farms[m.id] = makeFarm(); });
  return {
    money: 5_000, tick: 0, day: 1, season: 'spring', year: 1,
    farms, farmMeta: FARM_META, activeFarmId: 'muenchen',
    employees: [], selectedCrop: 'wheat',
    stats: { totalHarvested: 0, totalEarned: 0 },
    paused: false,
    hofladen: {},
    // Starter equipment — the old family farm machinery
    vehicles: [
      { uid: 1, defId: 'traktor', farmId: 'muenchen', inUseUntilTick: 0 },
    ],
    implements: [
      { uid: 2, defId: 'pflug',       farmId: 'muenchen', inUseUntilTick: 0, pairedVehicleUid: null },
      { uid: 3, defId: 'saemaschine', farmId: 'muenchen', inUseUntilTick: 0, pairedVehicleUid: null },
    ],
    nextVehicleUid: 4,
  };
}

function updateFarm(state: GameState, farmId: string, upd: Partial<FarmLocation>): GameState {
  return { ...state, farms: { ...state.farms, [farmId]: { ...state.farms[farmId], ...upd } } };
}

function updPlot(farm: FarmLocation, plotId: number, upd: Partial<Plot>): Plot[] {
  return farm.plots.map(p => p.id === plotId ? { ...p, ...upd } : p);
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export function tickGame(state: GameState): GameState {
  if (state.paused) return state;
  const tick = state.tick + 1;
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const day    = totalDays + 1;
  const season = SEASONS[Math.floor(totalDays / DAYS_PER_SEASON) % 4];
  const year   = Math.floor(totalDays / (DAYS_PER_SEASON * 4)) + 1;

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
          if (!animal.noProductCycle && !s.productionReady && tick - s.lastCollectedAt >= animal.cycleSeconds)
            s = { ...s, productionReady: true };
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

  let money = state.money;
  if (day !== state.day) money -= state.employees.reduce((s, e) => s + e.wage, 0);
  return {
    ...state, tick, day, season, year, farms, money,
    stats: {
      totalHarvested: state.stats.totalHarvested + statsDelta.totalHarvested,
      totalEarned: state.stats.totalEarned + statsDelta.totalEarned,
    },
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

export function openNewFarm(state: GameState, city: string, farmName: string, lat: number, lon: number, cost: number): GameState {
  if (state.money < cost) { bus.emit('notification', '💸 Nicht genug Geld!'); return state; }
  const id = city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
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
  if (!tractor) { bus.emit('notification', '🚜 Kein freier Traktor am Standort — kaufe einen im Fahrzeug-Shop'); return state; }
  if (!pflug)   { bus.emit('notification', '⛏️ Kein freier Pflug am Standort — kaufe ein Anbaugerät im Shop'); return state; }

  bus.emit('notification', '⛏️ Pflügen gestartet…');
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_tilled',
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    }) }),
    ...markInUse(state, tractor.uid, pflug.uid, FIELD_WORK_TICKS),
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
  if (!tractor) { bus.emit('notification', '🚜 Kein freier Traktor am Standort — kaufe einen im Fahrzeug-Shop'); return state; }
  if (!saem)    { bus.emit('notification', '🌱 Keine freie Sämaschine am Standort — kaufe ein Anbaugerät im Shop'); return state; }

  bus.emit('notification', `🌱 ${crop.name} wird gesät…`);
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_planted', cropId,
      growthTicks: crop.growthTicks, plantedAt: 0,
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    })}),
    money: state.money - crop.seedCost,
    ...markInUse(state, tractor.uid, saem.uid, FIELD_WORK_TICKS),
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
  if (!harvester) { bus.emit('notification', '🚜 Kein freies Fahrzeug zum Ernten — Traktor oder Mähdrescher nötig'); return state; }

  bus.emit('notification', `🌾 ${crop.name} wird geerntet…`);
  return {
    ...updateFarm(state, farmId, { plots: updPlot(farm, plotId, {
      fieldState: 'being_harvested',
      actionStartTick: state.tick, actionDurationTicks: FIELD_WORK_TICKS,
    }) }),
    vehicles: state.vehicles.map(v =>
      v.uid === harvester.uid ? { ...v, inUseUntilTick: state.tick + FIELD_WORK_TICKS } : v
    ),
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
    productionReady: false, lastCollectedAt: state.tick, lastBreedingAt: state.tick };
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
  if (!stallSlot?.productionReady || !stallSlot.animalId) return state;
  const animal = ANIMALS[stallSlot.animalId];
  if (!animal) return state;
  const yield_ = computeYield(stallSlot.animalId, stallSlot.animalCount, plot.stallSize);
  if (yield_ > 0) bus.emit('notification', `🧺 ${yield_} ${animal.productEmoji} ${animal.productName} eingelagert`);
  const newSlot: StallSlot = { ...stallSlot, productionReady: false, lastCollectedAt: state.tick };
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
    productionReady: false, lastCollectedAt: state.tick, lastBreedingAt: state.tick };
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

export function sellFromStorage(state: GameState, farmId: string, productId: string, amount: number): GameState {
  const farm = state.farms[farmId];
  if (!farm) return state;
  const stored = farm.storage[productId] ?? 0;
  const actual = Math.min(amount, stored);
  if (actual <= 0) return state;
  const product = PRODUCTS[productId];
  if (!product) return state;
  const earned = Math.round(actual * product.sellPricePerUnit);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function growthProgress(plot: Plot, currentTick: number): number {
  if (plot.plotType !== 'field' || plot.fieldState !== 'planted' || plot.growthTicks === 0) return 0;
  return Math.min(1, (currentTick - plot.plantedAt) / plot.growthTicks);
}

export function slotProgress(slot: StallSlot, currentTick: number): number {
  if (!slot.animalId || slot.productionReady) return slot.productionReady ? 1 : 0;
  const animal = ANIMALS[slot.animalId];
  if (!animal || slot.animalCount === 0) return 0;
  return Math.min(1, (currentTick - slot.lastCollectedAt) / animal.cycleSeconds);
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
    if (p.plotType === 'stall') return p.stallA.productionReady || (p.stallB?.productionReady ?? false);
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
