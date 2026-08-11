import { describe, it, expect } from 'vitest';
import {
  createInitialState, designateField, tillPlot, plantCrop, harvestPlot, tickGame,
  FIELD_WORK_TICKS,
} from './Farm';
import { CROPS } from '../data/crops';

const FARM_ID = 'muenchen';
const PLOT_ID = 0; // unlocked from the start

function advanceTicks(state: ReturnType<typeof createInitialState>, n: number) {
  let s = state;
  for (let i = 0; i < n; i++) s = tickGame(s).state;
  return s;
}

describe('field lifecycle: empty -> fallow -> tilled -> planted -> ready -> harvested', () => {
  // Uses the fastest-growing crop (tomato, 3 days) to keep the tick loop short;
  // the transition rules themselves are crop-independent.
  const crop = CROPS.tomato;

  it('completes the whole cycle deterministically as real ticks pass', () => {
    let state = createInitialState();
    const startingMoney = state.money;

    state = designateField(state, FARM_ID, PLOT_ID);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('fallow');

    state = tillPlot(state, FARM_ID, PLOT_ID);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('being_tilled');

    // Not done yet, one tick before completion
    state = advanceTicks(state, FIELD_WORK_TICKS - 1);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('being_tilled');
    state = advanceTicks(state, 1);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('tilled');

    state = plantCrop(state, FARM_ID, PLOT_ID, crop.id);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('being_planted');
    expect(state.money).toBe(startingMoney - crop.seedCost);

    state = advanceTicks(state, FIELD_WORK_TICKS);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('planted');

    state = advanceTicks(state, crop.growthTicks - 1);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('planted');
    state = advanceTicks(state, 1);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('ready');

    const harvestedBefore = state.stats.totalHarvested;
    state = harvestPlot(state, FARM_ID, PLOT_ID);
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('being_harvested');

    state = advanceTicks(state, FIELD_WORK_TICKS);
    const plot = state.farms[FARM_ID].plots[PLOT_ID];
    expect(plot.fieldState).toBe('fallow');
    expect(plot.cropId).toBeNull();
    expect(state.farms[FARM_ID].storage[crop.id]).toBe(crop.yieldKg);
    expect(state.stats.totalHarvested).toBe(harvestedBefore + 1);
  }, 30_000);

  it('does not let planting proceed without enough money for seed', () => {
    let state = createInitialState();
    state = designateField(state, FARM_ID, PLOT_ID);
    state = tillPlot(state, FARM_ID, PLOT_ID);
    state = advanceTicks(state, FIELD_WORK_TICKS);
    state = { ...state, money: crop.seedCost - 1 };

    const before = state;
    state = plantCrop(state, FARM_ID, PLOT_ID, crop.id);
    expect(state).toBe(before); // no-op: state reference unchanged
    expect(state.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('tilled');
  });

  it('does not till a field that is not fallow', () => {
    const state = createInitialState(); // plot 0 starts 'empty', not 'fallow'
    const result = tillPlot(state, FARM_ID, PLOT_ID);
    expect(result).toBe(state); // no-op
    expect(result.farms[FARM_ID].plots[PLOT_ID].fieldState).toBe('empty');
  });

  it('does not harvest a field that is not ready', () => {
    let state = createInitialState();
    state = designateField(state, FARM_ID, PLOT_ID);
    const before = state;
    const result = harvestPlot(state, FARM_ID, PLOT_ID);
    expect(result).toBe(before); // no-op: fieldState is 'fallow', not 'ready'
  });
});

describe('createInitialState with a chosen starting location', () => {
  it('defaults to München when called without arguments', () => {
    const state = createInitialState();
    expect(state.activeFarmId).toBe('muenchen');
    expect(state.farmMeta).toEqual([expect.objectContaining({ id: 'muenchen', city: 'München' })]);
    expect(Object.keys(state.farms)).toEqual(['muenchen']);
  });

  it('sets up the starter farm at the given location instead', () => {
    const state = createInitialState({ id: 'hamburg_123', name: 'Hof Elbe', city: 'Hamburg', lat: 53.55, lon: 9.99 });

    expect(state.activeFarmId).toBe('hamburg_123');
    expect(Object.keys(state.farms)).toEqual(['hamburg_123']);
    expect(state.farmMeta).toEqual([
      { id: 'hamburg_123', name: 'Hof Elbe', city: 'Hamburg', unlocked: true, unlockCost: 0, lat: 53.55, lon: 9.99 },
    ]);
    // Starter-Ausrüstung/Personal hängen am gewählten Standort, nicht an München.
    expect(state.employees[0].farmId).toBe('hamburg_123');
    expect(state.vehicles[0].farmId).toBe('hamburg_123');
    expect(state.implements.every(i => i.farmId === 'hamburg_123')).toBe(true);
  });
});
