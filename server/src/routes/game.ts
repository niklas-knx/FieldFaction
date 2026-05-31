import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();
const SAVE_VERSION = 7; // muss mit src/main.ts übereinstimmen
const MAX_CATCHUP_TICKS = 7 * 24 * 60 * 60; // max 7 Tage Offline-Fortschritt

// GET /api/game/state
// Gibt den gespeicherten Spielstand zurück, inkl. Anzahl Offline-Ticks
router.get('/state', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [rows]: any = await pool.execute(
      'SELECT state_json, save_version, last_saved_at FROM game_states WHERE user_id = ?',
      [userId]
    );

    if (rows.length === 0) {
      // Kein Spielstand → neues Spiel
      return res.json({ newGame: true });
    }

    const { state_json, save_version, last_saved_at } = rows[0];
    if (save_version !== SAVE_VERSION) {
      // Inkompatible Version → neues Spiel
      return res.json({ newGame: true, reason: 'version_mismatch' });
    }

    const elapsedMs = Date.now() - Number(last_saved_at);
    const offlineTicks = Math.min(
      Math.floor(elapsedMs / 1000),
      MAX_CATCHUP_TICKS
    );

    return res.json({
      state: JSON.parse(state_json),
      offlineTicks,
    });
  } catch (err) {
    console.error('[game/state GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// PUT /api/game/state
// Speichert den aktuellen Spielstand
router.put('/state', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { state } = req.body ?? {};

  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Kein Spielstand übermittelt' });
  }

  try {
    await pool.execute(
      `INSERT INTO game_states (user_id, save_version, state_json, last_saved_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         save_version  = VALUES(save_version),
         state_json    = VALUES(state_json),
         last_saved_at = VALUES(last_saved_at)`,
      [userId, SAVE_VERSION, JSON.stringify(state), Date.now()]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[game/state PUT]', err);
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
