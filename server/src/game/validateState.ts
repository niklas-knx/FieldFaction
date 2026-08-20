// Defensive Shape-Prüfung für Spielstände.
//
// Seit Issue #7 berechnet ausschließlich der Server den Spielzustand (siehe
// simulate.ts/actions.ts) — der Client sendet nur noch Aktions-Absichten, nie mehr
// einen fertigen State-Blob. Cross-Save-Plausibilitätsprüfung (frühere
// validateStateTransition) ist damit hinfällig: es gibt keinen Client-PUT mehr, den
// sie hätte schützen müssen. Was bleibt, ist eine billige Absicherung gegen Bugs in
// der eigenen Simulation, bevor ein kaputter Zustand persistiert wird.
const TICKS_PER_DAY = 86_400;

// Groß genug, dass kein realer Spielverlauf je drankommt, klein genug, um evidente
// Dateninkonsistenzen (z.B. durch einen Bug in Farm.ts) früh zu erkennen.
const MAX_ARRAY_LENGTHS: Record<string, number> = {
  employees: 200,
  vehicles: 300,
  implements: 300,
  deliveries: 100,
};
const MAX_FARMS = 100;

export interface ValidationResult { valid: boolean; reason?: string; }

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateGameStateShape(state: any): ValidationResult {
  if (!state || typeof state !== 'object') return { valid: false, reason: 'state ist kein Objekt' };
  if (!isFiniteNumber(state.money) || state.money < -1) return { valid: false, reason: 'money ungültig' };
  if (!isFiniteNumber(state.debt) || state.debt < 0) return { valid: false, reason: 'debt ungültig' };
  if (!isFiniteNumber(state.tick) || state.tick < 0) return { valid: false, reason: 'tick ungültig' };
  if (!isFiniteNumber(state.day) || state.day < 1) return { valid: false, reason: 'day ungültig' };

  // day muss exakt aus tick berechenbar sein (deterministische Formel, kein Spielraum nötig)
  const expectedDay = Math.floor(state.tick / TICKS_PER_DAY) + 1;
  if (state.day !== expectedDay) {
    return { valid: false, reason: `day passt nicht zu tick (erwartet ${expectedDay}, war ${state.day})` };
  }

  for (const [field, max] of Object.entries(MAX_ARRAY_LENGTHS)) {
    const arr = state[field];
    if (!Array.isArray(arr)) return { valid: false, reason: `${field} ist kein Array` };
    if (arr.length > max) return { valid: false, reason: `${field} hat zu viele Einträge (${arr.length} > ${max})` };
  }

  if (!state.farms || typeof state.farms !== 'object' || Array.isArray(state.farms)) {
    return { valid: false, reason: 'farms ungültig' };
  }
  if (Object.keys(state.farms).length > MAX_FARMS) return { valid: false, reason: 'zu viele Standorte' };
  if (!Array.isArray(state.farmMeta)) return { valid: false, reason: 'farmMeta ungültig' };

  return { valid: true };
}
