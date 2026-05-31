import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { CITY_MERCHANTS, getMerchantPrice } from '../data/merchantData';

const router = Router();

// ── Offene Anfragen abrufen ───────────────────────────────────────────────────

router.get('/requests', requireAuth, async (req: Request, res: Response) => {
  const { cities } = req.query; // comma-separated city ids
  const now = Date.now();

  try {
    let rows: any[];
    if (cities && typeof cities === 'string') {
      const cityList = cities.split(',').filter(Boolean);
      if (cityList.length === 0) return res.json({ requests: [] });
      const placeholders = cityList.map(() => '?').join(',');
      const [r]: any = await pool.execute(
        `SELECT r.*, (SELECT COUNT(*) FROM market_bids b WHERE b.request_id = r.id AND b.status = 'pending') AS bid_count
         FROM market_requests r
         WHERE r.city IN (${placeholders}) AND r.status = 'open' AND r.expires_at > ?
         ORDER BY r.expires_at ASC`,
        [...cityList, now]
      );
      rows = r;
    } else {
      const [r]: any = await pool.execute(
        `SELECT r.*, (SELECT COUNT(*) FROM market_bids b WHERE b.request_id = r.id AND b.status = 'pending') AS bid_count
         FROM market_requests r
         WHERE r.status = 'open' AND r.expires_at > ?
         ORDER BY r.expires_at ASC`,
        [now]
      );
      rows = r;
    }

    return res.json({
      requests: rows.map(r => ({
        id: r.id,
        city: r.city,
        merchantId: r.merchant_id,
        productId: r.product_id,
        quantity: r.quantity,
        maxPricePerUnit: r.max_price_per_unit,
        expiresAt: r.expires_at,
        bidCount: r.bid_count,
      })),
    });
  } catch (err) {
    console.error('[market/requests GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Angebot abgeben ───────────────────────────────────────────────────────────

router.post('/bid', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { requestId, farmId, pricePerUnit, quantityOffered } = req.body ?? {};

  if (!requestId || !farmId || !Number.isFinite(pricePerUnit) || !Number.isInteger(quantityOffered)
      || pricePerUnit <= 0 || quantityOffered <= 0)
    return res.status(400).json({ error: 'Ungültige Parameter' });

  try {
    const [reqRows]: any = await pool.execute(
      'SELECT * FROM market_requests WHERE id = ? AND status = "open" AND expires_at > ?',
      [requestId, Date.now()]
    );
    const request = reqRows[0];
    if (!request) return res.status(404).json({ error: 'Anfrage nicht mehr offen' });

    if (pricePerUnit > request.max_price_per_unit)
      return res.status(400).json({ error: `Max. Preis: ${request.max_price_per_unit.toFixed(2)} €` });

    // Nur ein Angebot pro Spieler pro Anfrage (Update falls schon vorhanden)
    const [existing]: any = await pool.execute(
      'SELECT id FROM market_bids WHERE request_id = ? AND user_id = ? AND status = "pending"',
      [requestId, userId]
    );

    if (existing.length > 0) {
      await pool.execute(
        'UPDATE market_bids SET farm_id = ?, price_per_unit = ?, quantity_offered = ?, created_at = ? WHERE id = ?',
        [farmId, pricePerUnit, quantityOffered, Date.now(), existing[0].id]
      );
      return res.json({ id: existing[0].id, updated: true });
    }

    const [result]: any = await pool.execute(
      'INSERT INTO market_bids (request_id, user_id, farm_id, price_per_unit, quantity_offered, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [requestId, userId, farmId, pricePerUnit, quantityOffered, Date.now()]
    );
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('[market/bid POST]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Meine Gebote abrufen ──────────────────────────────────────────────────────

router.get('/bids', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const since  = Date.now() - 30 * 60 * 1000; // letzte 30 Minuten
  try {
    const [rows]: any = await pool.execute(
      `SELECT b.id, b.request_id, b.farm_id, b.price_per_unit, b.quantity_offered, b.score, b.status, b.created_at,
              r.city, r.merchant_id, r.product_id, r.quantity AS req_quantity, r.max_price_per_unit, r.expires_at
       FROM market_bids b
       JOIN market_requests r ON b.request_id = r.id
       WHERE b.user_id = ? AND (b.status = 'pending' OR b.created_at > ?)
       ORDER BY b.created_at DESC
       LIMIT 30`,
      [userId, since]
    );
    return res.json({
      bids: rows.map((b: any) => ({
        id: b.id,
        requestId: b.request_id,
        farmId: b.farm_id,
        pricePerUnit: b.price_per_unit,
        quantityOffered: b.quantity_offered,
        score: b.score,
        status: b.status,
        createdAt: b.created_at,
        request: {
          city: b.city,
          merchantId: b.merchant_id,
          productId: b.product_id,
          quantity: b.req_quantity,
          maxPricePerUnit: b.max_price_per_unit,
          expiresAt: b.expires_at,
        },
      })),
    });
  } catch (err) {
    console.error('[market/bids GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Angebot zurückziehen ──────────────────────────────────────────────────────

router.delete('/bid/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const bidId  = Number(req.params.id);
  if (!Number.isFinite(bidId)) return res.status(400).json({ error: 'Ungültige ID' });
  try {
    await pool.execute(
      'UPDATE market_bids SET status = "lost" WHERE id = ? AND user_id = ? AND status = "pending"',
      [bidId, userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[market/bid DELETE]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Credits abrufen ───────────────────────────────────────────────────────────

router.get('/credits', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [rows]: any = await pool.execute(
      'SELECT id, amount_eur, product_changes_json, description FROM market_credits WHERE user_id = ? AND applied = 0 ORDER BY created_at ASC',
      [userId]
    );
    return res.json({
      credits: rows.map((r: any) => ({
        id: r.id,
        amountEur: r.amount_eur,
        productChanges: JSON.parse(r.product_changes_json ?? '[]'),
        description: r.description,
      })),
    });
  } catch (err) {
    console.error('[market/credits GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Credits als angewendet markieren ─────────────────────────────────────────

router.post('/credits/apply', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Keine IDs' });
  const ph = ids.map(() => '?').join(',');
  try {
    await pool.execute(
      `UPDATE market_credits SET applied = 1 WHERE user_id = ? AND id IN (${ph})`,
      [userId, ...ids]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[market/credits/apply POST]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// ── Reputation abrufen ────────────────────────────────────────────────────────

router.get('/reputation', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [rows]: any = await pool.execute(
      'SELECT market_city, score FROM market_reputation WHERE user_id = ?',
      [userId]
    );
    const reputation: Record<string, number> = {};
    for (const r of rows) reputation[r.market_city] = r.score;
    return res.json({ reputation });
  } catch (err) {
    console.error('[market/reputation GET]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
