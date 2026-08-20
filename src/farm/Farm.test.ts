import { describe, it, expect } from 'vitest';
import {
  createInitialState, designateField, tillPlot, plantCrop, harvestPlot, tickGame,
  buildStall, collectStall, takeLoan, repayLoan,
  FIELD_WORK_TICKS, TICKS_PER_DAY, MAX_DEBT, DEBT_INTEREST_RATE,
} from './Farm';
import { CROPS } from '../data/crops';
import { stallCapacity } from '../data/animals';

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

describe('animal production trickles into a capped stall buffer', () => {
  it('accrues gradually over the day, hard-caps at stallCapacity, and resumes after collecting', () => {
    let state = createInitialState();
    state = buildStall(state, FARM_ID, PLOT_ID, 'chicken', 'full');

    // Direkt auf 50 Tiere (Freiland-Maximum) setzen, um Zucht-Nebeneffekte (alle 600 Ticks
    // +1 Tier) aus diesem Test rauszuhalten — es geht hier nur um die Produktionsrate.
    state = {
      ...state,
      farms: {
        ...state.farms,
        [FARM_ID]: {
          ...state.farms[FARM_ID],
          plots: state.farms[FARM_ID].plots.map(p =>
            p.id === PLOT_ID ? { ...p, stallA: { ...p.stallA, animalCount: 50 } } : p
          ),
        },
      },
    };
    const stallA = () => state.farms[FARM_ID].plots[PLOT_ID].stallA;

    // 50 Hühner × 1 Ei/Tag × Freiland-Happiness 1.0 = 50 Eier/Tag → Kapazität = ceil(50/6) = 9
    const capacity = stallCapacity('chicken', 50, 'full');
    expect(capacity).toBe(9);

    // Rate = 50/86400 Eier/Sekunde. Für das erste ganze Ei: ceil(86400/50) = 1728 Ticks.
    state = advanceTicks(state, 1727);
    expect(stallA().outputReady).toBe(0); // noch nicht alle Hühner auf einmal
    state = advanceTicks(state, 1);
    expect(stallA().outputReady).toBe(1);

    // Weit über die Kapazität hinaus laufen lassen — darf trotzdem nicht mehr als 9 werden.
    state = advanceTicks(state, 50_000);
    expect(stallA().outputReady).toBe(capacity);

    // Einlagern leert den Puffer ins Lager; danach läuft die Produktion weiter.
    state = collectStall(state, FARM_ID, PLOT_ID, 0);
    expect(stallA().outputReady).toBe(0);
    expect(state.farms[FARM_ID].storage.eggs).toBe(capacity);

    state = advanceTicks(state, 1728);
    expect(stallA().outputReady).toBe(1);
  }, 30_000);
});

describe('credit system', () => {
  it('takeLoan increases money and debt by the same amount, capped at the limit', () => {
    let state = createInitialState();
    const startMoney = state.money;

    state = takeLoan(state, 3_000);
    expect(state.money).toBe(startMoney + 3_000);
    expect(state.debt).toBe(3_000);

    // Nachfrage über das verbleibende Limit hinaus -> nur bis zur Grenze
    state = takeLoan(state, MAX_DEBT);
    expect(state.debt).toBe(MAX_DEBT);
    expect(state.money).toBe(startMoney + MAX_DEBT);
  });

  it('does nothing once the debt limit is already reached', () => {
    const state = { ...createInitialState(), debt: MAX_DEBT };
    const result = takeLoan(state, 100);
    expect(result).toBe(state); // no-op: state reference unchanged
  });

  it('repayLoan reduces money and debt by the same amount, capped at the open debt', () => {
    let state = createInitialState();
    state = takeLoan(state, 2_000);
    const moneyAfterLoan = state.money;

    state = repayLoan(state, 500);
    expect(state.debt).toBe(1_500);
    expect(state.money).toBe(moneyAfterLoan - 500);

    // Mehr zurückzahlen wollen als offen ist -> kappt auf die Restschuld
    state = repayLoan(state, 10_000);
    expect(state.debt).toBe(0);
  });

  it('caps repayment at available money, not just at the open debt', () => {
    const state = { ...createInitialState(), money: 100, debt: 5_000 };
    const result = repayLoan(state, 5_000);
    expect(result.money).toBe(0);
    expect(result.debt).toBe(4_900);
  });

  it('accrues interest exactly once at the day boundary via tickGame', () => {
    let state = { ...createInitialState(), debt: 1_000 };
    // Kurz vor dem Tageswechsel: noch keine Zinsen
    state = advanceTicks(state, TICKS_PER_DAY - 1);
    expect(state.debt).toBe(1_000);
    // Der Tick, der den Tag wechselt, verzinst genau einmal
    state = advanceTicks(state, 1);
    expect(state.debt).toBe(1_000 + Math.round(1_000 * DEBT_INTEREST_RATE));
  });

  it('normalizes a missing debt field (pre-credit-system saves) to 0 instead of NaN', () => {
    const legacyState: any = createInitialState();
    delete legacyState.debt;
    const result = tickGame(legacyState).state;
    expect(result.debt).toBe(0);
    expect(Number.isNaN(result.debt)).toBe(false);
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
