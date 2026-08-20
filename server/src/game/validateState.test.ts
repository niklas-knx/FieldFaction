import { describe, it, expect } from 'vitest';
import { validateGameStateShape } from './validateState';

const TICKS_PER_DAY = 86_400;

function baseState(overrides: Record<string, any> = {}): any {
  return {
    money: 5_000,
    debt: 0,
    tick: 0,
    day: 1,
    employees: [],
    vehicles: [],
    implements: [],
    deliveries: [],
    farms: { muenchen: {} },
    farmMeta: [{ id: 'muenchen' }],
    ...overrides,
  };
}

describe('validateGameStateShape', () => {
  it('accepts a well-formed fresh state', () => {
    expect(validateGameStateShape(baseState())).toEqual({ valid: true });
  });

  it('rejects a non-object state', () => {
    expect(validateGameStateShape(null).valid).toBe(false);
    expect(validateGameStateShape('nope').valid).toBe(false);
  });

  it('rejects non-finite or negative money', () => {
    expect(validateGameStateShape(baseState({ money: NaN })).valid).toBe(false);
    expect(validateGameStateShape(baseState({ money: -5 })).valid).toBe(false);
    // -1 is the documented floor (debt buffer) and must still pass
    expect(validateGameStateShape(baseState({ money: -1 })).valid).toBe(true);
  });

  it('rejects a negative or non-finite debt', () => {
    expect(validateGameStateShape(baseState({ debt: NaN })).valid).toBe(false);
    expect(validateGameStateShape(baseState({ debt: -1 })).valid).toBe(false);
    expect(validateGameStateShape(baseState({ debt: 10_000 })).valid).toBe(true);
  });

  it('rejects a negative or non-finite tick', () => {
    expect(validateGameStateShape(baseState({ tick: -1 })).valid).toBe(false);
    expect(validateGameStateShape(baseState({ tick: Infinity })).valid).toBe(false);
  });

  it('rejects day < 1', () => {
    expect(validateGameStateShape(baseState({ day: 0 })).valid).toBe(false);
  });

  it('requires day to be exactly derived from tick', () => {
    const result = validateGameStateShape(baseState({ tick: TICKS_PER_DAY, day: 1 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/day passt nicht zu tick/);

    expect(validateGameStateShape(baseState({ tick: TICKS_PER_DAY, day: 2 })).valid).toBe(true);
    expect(validateGameStateShape(baseState({ tick: TICKS_PER_DAY - 1, day: 1 })).valid).toBe(true);
  });

  it('rejects arrays that are not arrays or exceed their cap', () => {
    expect(validateGameStateShape(baseState({ employees: 'nope' })).valid).toBe(false);
    const tooMany = Array.from({ length: 201 }, () => ({}));
    expect(validateGameStateShape(baseState({ employees: tooMany })).valid).toBe(false);
  });

  it('rejects malformed or oversized farms', () => {
    expect(validateGameStateShape(baseState({ farms: [] })).valid).toBe(false);
    expect(validateGameStateShape(baseState({ farms: null })).valid).toBe(false);

    const tooManyFarms: Record<string, any> = {};
    for (let i = 0; i < 101; i++) tooManyFarms[`farm_${i}`] = {};
    expect(validateGameStateShape(baseState({ farms: tooManyFarms })).valid).toBe(false);
  });

  it('rejects a missing farmMeta array', () => {
    expect(validateGameStateShape(baseState({ farmMeta: undefined })).valid).toBe(false);
  });
});
