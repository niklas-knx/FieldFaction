import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { validateGameStateShape } from '../game/validateState';
import { advanceState, createInitialState, applyMarketCredits } from '../game/simulate';
import type { MarketCredit } from '../game/simulate';
import { GAME_ACTIONS, isGameActionType } from '../game/actions';
import { bus } from '../../../src/core/EventBus';

const router = Router();
const SAVE_VERSION = 11; // muss mit src/main.ts übereinstimmen
const MAX_CATCHUP_TICKS = 7 * 24 * 60 * 60; // max 7 Tage Nachholzeit pro Sync

async function loadStateRow(userId: number): Promise<{ state_json: string; last_saved_at: number } | null> {
  const [rows]: any = await pool.execute(
    'SELECT state_json, save_version, last_saved_at FROM game_states WHERE user_id = ? AND save_version = ?',
    [userId, SAVE_VERSION]
  );
  return rows[0] ?? null;
}

async function persist(userId: number, state: unknown, now: number): Promise<void> {
  await pool.execute(
    `INSERT INTO game_states (user_id, save_version, state_json, last_saved_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       save_version  = VALUES(save_version),
       state_json    = VALUES(state_json),
       last_saved_at = VALUES(last_saved_at)`,
    [userId, SAVE_VERSION, JSON.stringify(state), now]
  );
}

// Gewonnene Markt-Gebote/Hofladen-Verkäufe (server-seitig async in market_credits
// gesammelt, siehe server/src/market/matching.ts) direkt in den Spielstand einbuchen,
// statt wie früher den Client per Polling lokal rechnen und "als angewendet markieren"
// zu lassen — der Client hat keine Schreibrechte auf den State mehr, also muss der
// Server das selbst erledigen, sobald er den Stand ohnehin lädt.
async function applyPendingCredits(userId: number, state: any): Promise<any> {
  const [rows]: any = await pool.execute(
    'SELECT id, amount_eur, product_changes_json, description FROM market_credits WHERE user_id = ? AND applied = 0',
    [userId]
  );
  if (rows.length === 0) return state;

  const credits: MarketCredit[] = rows.map((r: any) => ({
    id: r.id,
    amountEur: r.amount_eur,
    productChanges: JSON.parse(r.product_changes_json ?? '[]'),
    description: r.description,
    orderId: null,
  }));

  const applied = applyMarketCredits(state, credits);

  const ids = rows.map((r: any) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  await pool.execute(
    `UPDATE market_credits SET applied = 1 WHERE user_id = ? AND id IN (${placeholders})`,
    [userId, ...ids]
  );

  return applied;
}

// Lädt den gespeicherten Stand (legt bei Bedarf einen neuen an), bucht offene Markt-
// Credits ein und lässt das Ergebnis per advanceState() bis zum aktuellen Zeitpunkt
// weiterlaufen — seit Issue #7 die einzige Stelle, an der überhaupt Ticks entstehen.
// Persistiert hier bewusst NICHT: Aufrufer (GET /state, POST /action) entscheiden
// selbst, mit welchem Endergebnis gespeichert wird.
async function loadAndAdvance(userId: number, now: number) {
  const row = await loadStateRow(userId);

  const isNew = !row;
  let state: any = row ? JSON.parse(row.state_json) : createInitialState();
  const lastSavedAt = row ? Number(row.last_saved_at) : now;

  state = await applyPendingCredits(userId, state);

  const elapsedSeconds = Math.max(0, (now - lastSavedAt) / 1000);
  const { state: advanced, events } = advanceState(state, elapsedSeconds, MAX_CATCHUP_TICKS);

  const shape = validateGameStateShape(advanced);
  if (!shape.valid) {
    // Bug in der Simulation, nicht Cheating (der Client liefert hier keine Daten mehr) —
    // laut loggen statt einen kaputten Zustand weiterzureichen.
    throw new Error(`internal_state_invalid: ${shape.reason}`);
  }

  return {
    state: advanced,
    events,
    isNew,
    offlineSeconds: Math.round(elapsedSeconds),
    // Preise vor dem Nachholen — nur für die "Willkommen zurück"-Anzeige (größte
    // Kursbewegungen während der Abwesenheit), die der Client mangels eigener
    // Simulation nicht mehr selbst berechnen kann.
    previousMarketPrices: state.marketPrices,
  };
}

// GET /api/game/state
// Bringt den gespeicherten Stand auf "jetzt" (Feldwachstum, Tierproduktion, Lieferungen,
// Löhne, …) und liefert ihn zusammen mit den dabei aufgetretenen Ereignissen zurück.
router.get('/state', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const now = Date.now();
    const { state, events, isNew, offlineSeconds, previousMarketPrices } = await loadAndAdvance(userId, now);
    await persist(userId, state, now);
    return res.json({
      newGame: isNew,
      state,
      events,
      offlineSeconds: isNew ? 0 : offlineSeconds,
      previousMarketPrices,
    });
  } catch (err) {
    console.error('[game/state GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/game/action
// Einziger Weg, den Spielzustand zu verändern: der Client schickt eine Absicht
// (Aktionsname + Argumente), nie einen fertigen State. Der Server bringt den
// gespeicherten Stand zuerst auf "jetzt" und wendet die Aktion dann serverseitig mit
// derselben Logik an, die früher der Client lokal ausgeführt hat (src/farm/Farm.ts).
router.post('/action', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { type, args } = req.body ?? {};

  if (!isGameActionType(type)) {
    return res.status(400).json({ error: `Unbekannte Aktion: ${String(type)}` });
  }
  if (args !== undefined && !Array.isArray(args)) {
    return res.status(400).json({ error: 'args muss ein Array sein' });
  }

  try {
    const now = Date.now();
    const { state: advanced, events } = await loadAndAdvance(userId, now);

    // Farm.ts-Aktionen melden Ablehnungsgründe (kein Geld, keine freie Maschine, …) per
    // EventBus-Notification statt Rückgabewert — kurz mitlesen statt alle ~26 Funktionen
    // auf ein strukturiertes Fehlerformat umzuschreiben.
    const notifications: string[] = [];
    const unsubscribe = bus.on<string>('notification', text => notifications.push(text));
    let result: unknown;
    try {
      // GAME_ACTIONS is a union of differently-shaped pure reducers; the dispatcher is
      // inherently dynamic (type name comes from the request body), so the exact
      // parameter tuple can't be statically verified here — the individual functions
      // guard their own preconditions (see actions.ts comments for expected arg order).
      const action = GAME_ACTIONS[type] as (...fnArgs: any[]) => unknown;
      result = action(advanced, ...(Array.isArray(args) ? args : []));
    } finally {
      unsubscribe();
    }

    const shape = validateGameStateShape(result);
    if (!shape.valid) {
      console.error(`[game/action] Ungültiger Zustand nach "${type}" für user=${userId}: ${shape.reason}`);
      return res.status(500).json({ error: 'Serverfehler' });
    }

    await persist(userId, result, now);
    return res.json({ state: result, events, notifications });
  } catch (err) {
    console.error('[game/action POST]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// DELETE /api/game/state  (Spielstand zurücksetzen)
router.delete('/state', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    await pool.execute('DELETE FROM game_states WHERE user_id = ?', [userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[game/state DELETE]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
