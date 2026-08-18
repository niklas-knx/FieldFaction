import { Router, Request, Response } from 'express';
import { pool } from '../db';
import type { PoolConnection } from 'mysql2/promise';
import { requireAuth } from '../middleware/auth';
import { validateGameStateShape } from '../game/validateState';
import {
  advanceState, createInitialState, applyMarketCredits, emptyTickEvents, slugifyCityId,
} from '../game/simulate';
import type { MarketCredit, StartLocationInput } from '../game/simulate';
import { GAME_ACTIONS, isGameActionType } from '../game/actions';
import { bus } from '../../../src/core/EventBus';
import { processHofladenSales, ensureMarketFresh } from '../market/matching';

const router = Router();
const SAVE_VERSION = 11; // muss mit src/main.ts übereinstimmen
const MAX_CATCHUP_TICKS = 7 * 24 * 60 * 60; // max 7 Tage Nachholzeit pro Sync

// Signalisiert "für diesen Account existiert noch kein Spielstand" — kein Fehler,
// sondern der erwartete Zustand direkt nach der Registrierung, bevor der Client per
// POST /start einen Startort gewählt hat.
class NoGameYetError extends Error {}
class BadStartRequestError extends Error {}
class InvalidStateError extends Error {}

// Serialisiert den kompletten Lade-Ändere-Speichere-Zyklus pro Nutzer. Ohne das könnten
// zwei nahezu gleichzeitige Requests desselben Accounts (z.B. zwei offene Geräte/Tabs)
// beide denselben Stand lesen, bevor der jeweils andere seine Änderung gespeichert hat —
// und Ergebnisse doppelt gutschreiben (z.B. denselben Stall-Ertrag zweimal einlagern).
// SELECT ... FOR UPDATE hält innerhalb der Transaktion einen Zeilen-Lock bis zum COMMIT;
// ein zweiter Request für denselben user_id wartet an genau dieser Stelle, statt mit
// veralteten Daten weiterzurechnen.
async function withUserLock<T>(userId: number, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function loadStateRow(
  conn: PoolConnection, userId: number
): Promise<{ state_json: string; last_saved_at: number } | null> {
  const [rows]: any = await conn.execute(
    'SELECT state_json, save_version, last_saved_at FROM game_states WHERE user_id = ? AND save_version = ? FOR UPDATE',
    [userId, SAVE_VERSION]
  );
  return rows[0] ?? null;
}

async function persist(conn: PoolConnection, userId: number, state: unknown, now: number): Promise<void> {
  await conn.execute(
    `INSERT INTO game_states (user_id, save_version, state_json, last_saved_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       save_version  = VALUES(save_version),
       state_json    = VALUES(state_json),
       last_saved_at = VALUES(last_saved_at)`,
    [userId, SAVE_VERSION, JSON.stringify(state), now]
  );
}

// Gewonnene Markt-Gebote (server-seitig async in market_credits gesammelt, siehe
// server/src/market/matching.ts) direkt in den Spielstand einbuchen, statt wie früher den
// Client per Polling lokal rechnen und "als angewendet markieren" zu lassen — der Client
// hat keine Schreibrechte auf den State mehr, also muss der Server das selbst erledigen,
// sobald er den Stand ohnehin lädt. Läuft in derselben Transaktion/Sperre wie der Rest des
// Lade-Zyklus, damit zwei gleichzeitige Requests nicht dieselben Credits doppelt einbuchen.
async function applyPendingCredits(conn: PoolConnection, userId: number, state: any): Promise<any> {
  const [rows]: any = await conn.execute(
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
  await conn.execute(
    `UPDATE market_credits SET applied = 1 WHERE user_id = ? AND id IN (${placeholders})`,
    [userId, ...ids]
  );

  return applied;
}

// Lädt den gespeicherten Stand, bucht offene Markt-Credits ein und lässt das Ergebnis
// per advanceState() bis zum aktuellen Zeitpunkt weiterlaufen — die einzige Stelle, an
// der überhaupt Ticks entstehen. Wirft NoGameYetError, wenn der Account noch keinen
// Startort gewählt hat (siehe POST /start). Persistiert hier bewusst NICHT: Aufrufer
// entscheiden selbst, mit welchem Endergebnis gespeichert wird — muss innerhalb derselben
// withUserLock-Transaktion aufgerufen werden wie der anschließende persist()-Call.
async function loadAndAdvance(conn: PoolConnection, userId: number, now: number) {
  // Ersetzt den früheren 60s-Server-Tick für Händler-Anfragen/Gebote: generiert/matched
  // nur, wenn seit dem letzten Sweep (über alle Spieler hinweg) genug Zeit vergangen ist.
  // Betrifft eine geteilte, nicht user-spezifische Ressource — bewusst außerhalb des
  // Zeilen-Locks oben, um andere Nutzer nicht unnötig zu blockieren.
  await ensureMarketFresh(now);

  const row = await loadStateRow(conn, userId);
  if (!row) throw new NoGameYetError();

  let state: any = JSON.parse(row.state_json);
  const lastSavedAt = Number(row.last_saved_at);

  state = await applyPendingCredits(conn, userId, state);

  const elapsedSeconds = Math.max(0, (now - lastSavedAt) / 1000);
  const cappedElapsedSeconds = Math.min(elapsedSeconds, MAX_CATCHUP_TICKS);
  const { state: advanced, events } = advanceState(state, elapsedSeconds, MAX_CATCHUP_TICKS);

  // Hofladen-Verkäufe: kein eigener Tick mehr, sondern hier mit demselben (gedeckelten)
  // Zeitfenster wie advanceState() nachgerechnet — siehe processHofladenSales().
  const withHofladen = await processHofladenSales(userId, advanced, cappedElapsedSeconds, now);

  const shape = validateGameStateShape(withHofladen);
  if (!shape.valid) {
    // Bug in der Simulation, nicht Cheating (der Client liefert hier keine Daten mehr) —
    // laut loggen statt einen kaputten Zustand weiterzureichen.
    throw new Error(`internal_state_invalid: ${shape.reason}`);
  }

  return {
    state: withHofladen,
    events,
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
// Für frisch registrierte Accounts (noch kein Startort gewählt) kommt `newGame: true`
// ohne `state` zurück — der Client muss zuerst POST /start aufrufen.
router.get('/state', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const now = Date.now();
    const loaded = await withUserLock(userId, async conn => {
      const result = await loadAndAdvance(conn, userId, now);
      await persist(conn, userId, result.state, now);
      return result;
    });
    return res.json({ newGame: false, ...loaded });
  } catch (err) {
    if (err instanceof NoGameYetError) {
      return res.json({ newGame: true });
    }
    console.error('[game/state GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/game/start
// Einmaliger Schritt zwischen Registrierung und erstem Spiel: legt den Spielstand mit
// dem vom Spieler gewählten Startort an. Idempotent — existiert bereits ein Stand,
// wird die Auswahl ignoriert und einfach der (fortgeschriebene) bestehende Stand
// zurückgegeben, statt den Fortschritt zu überschreiben.
router.post('/start', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const now = Date.now();
  try {
    const result = await withUserLock(userId, async conn => {
      const existingRow = await loadStateRow(conn, userId);
      if (existingRow) {
        const loaded = await loadAndAdvance(conn, userId, now);
        await persist(conn, userId, loaded.state, now);
        return loaded;
      }

      const { city, farmName, lat, lon } = req.body ?? {};
      if (typeof city !== 'string' || !city.trim()) {
        throw new BadStartRequestError('Stadt erforderlich');
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new BadStartRequestError('Ungültige Koordinaten');
      }
      const trimmedCity = city.trim();
      const name = typeof farmName === 'string' && farmName.trim() ? farmName.trim() : `Gut ${trimmedCity}`;
      const start: StartLocationInput = { id: slugifyCityId(trimmedCity), name, city: trimmedCity, lat, lon };

      const state = createInitialState(start);
      const shape = validateGameStateShape(state);
      if (!shape.valid) {
        console.error(`[game/start] Ungültiger initialer Zustand: ${shape.reason}`);
        throw new InvalidStateError(shape.reason ?? 'unbekannt');
      }

      await persist(conn, userId, state, now);
      return { state, events: emptyTickEvents(), offlineSeconds: 0, previousMarketPrices: state.marketPrices };
    });

    return res.json({ newGame: false, ...result });
  } catch (err) {
    if (err instanceof BadStartRequestError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InvalidStateError) {
      return res.status(500).json({ error: 'Serverfehler' });
    }
    console.error('[game/start POST]', err);
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

  const notifications: string[] = [];
  try {
    const now = Date.now();
    const { result, events } = await withUserLock(userId, async conn => {
      const { state: advanced, events } = await loadAndAdvance(conn, userId, now);

      // Farm.ts-Aktionen melden Ablehnungsgründe (kein Geld, keine freie Maschine, …) per
      // EventBus-Notification statt Rückgabewert — kurz mitlesen statt alle ~26 Funktionen
      // auf ein strukturiertes Fehlerformat umzuschreiben.
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
        throw new InvalidStateError(shape.reason ?? 'unbekannt');
      }

      await persist(conn, userId, result, now);
      return { result, events };
    });

    return res.json({ state: result, events, notifications });
  } catch (err) {
    if (err instanceof NoGameYetError) {
      return res.status(409).json({ error: 'Noch kein Spielstand — zuerst einen Startort wählen' });
    }
    if (err instanceof InvalidStateError) {
      return res.status(500).json({ error: 'Serverfehler' });
    }
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
