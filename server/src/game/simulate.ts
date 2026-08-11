// Re-exports the client's pure game-logic module so the server can run the exact same
// simulation the browser used to run on its own — see Issue #7 (server-autoritative
// Anti-Cheat). No duplication of Farm.ts's rules on purpose: divergence between a
// server copy and the client copy would itself become a new class of bugs/exploits.
export { tickGame, createInitialState, emptyTickEvents, applyMarketCredits, slugifyCityId, TICKS_PER_DAY } from '../../../src/farm/Farm';
export type { GameState, MarketCredit } from '../../../src/types';
export type { TickEvents, StartLocationInput } from '../../../src/farm/Farm';

import { tickGame as tick, emptyTickEvents as emptyEvents } from '../../../src/farm/Farm';
import type { TickEvents } from '../../../src/farm/Farm';
import type { GameState } from '../../../src/types';

// Fast-forwards a state by `elapsedSeconds` real seconds (1 tick = 1 real second,
// see src/farm/Farm.ts), capped at `maxTicks`. Mirrors the offline-catchup loop that
// used to run client-side in src/main.ts after login — now the only place ticks are
// ever produced.
export function advanceState(
  state: GameState,
  elapsedSeconds: number,
  maxTicks: number,
): { state: GameState; events: TickEvents } {
  const ticks = Math.max(0, Math.min(Math.floor(elapsedSeconds), maxTicks));
  let s = state;
  const events = emptyEvents();
  for (let i = 0; i < ticks; i++) {
    const r = tick(s);
    s = r.state;
    events.fieldsHarvested       += r.events.fieldsHarvested;
    events.stallCollectionsReady += r.events.stallCollectionsReady;
    events.processingCompleted   += r.events.processingCompleted;
    events.wagesPaid             += r.events.wagesPaid;
    if (r.events.deliveriesArrived.length) events.deliveriesArrived.push(...r.events.deliveriesArrived);
    if (r.events.employeesFired.length)     events.employeesFired.push(...r.events.employeesFired);
  }
  return { state: s, events };
}
