import { pool } from '../db';
import { CITY_MERCHANTS, getMerchantPrice, getMerchantDemand, BASE_PRICES, MERCHANT_DEMAND, CITY_PROFILES } from '../data/merchantData';

const MATCHING_INTERVAL_MS = 60_000;
const MAX_REQUESTS_PER_CITY = 8;
const REQUEST_LIFETIME_MS   = 5 * 60 * 1000; // 5 Minuten

// Mengen-Spanne pro Produkt (min, max)
const QTY_RANGE: Record<string, [number, number]> = {
  wheat: [300, 1500], potato: [800, 4000], corn: [300, 1200],
  tomato: [200, 2000], sunflower: [100, 500], strawberry: [100, 800],
  milk: [100, 800], eggs: [50, 300], egg_box: [10, 80],
  pork: [20, 150], beef: [10, 100], chicken_meat: [20, 200],
  flour: [50, 400], cheese: [5, 80], sausage: [10, 100],
  butter: [10, 120], jam: [10, 100], sunflower_oil: [10, 100],
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async function getReputation(userId: number, city: string): Promise<number> {
  const [rows]: any = await pool.execute(
    'SELECT score FROM market_reputation WHERE user_id = ? AND market_city = ?',
    [userId, city]
  );
  return rows[0]?.score ?? 10.0;
}

async function upsertReputation(userId: number, city: string, delta: number): Promise<void> {
  await pool.execute(
    `INSERT INTO market_reputation (user_id, market_city, score)
     VALUES (?, ?, GREATEST(0, LEAST(100, 10 + ?)))
     ON DUPLICATE KEY UPDATE score = GREATEST(0, LEAST(100, score + ?))`,
    [userId, city, delta, delta]
  );
}

async function createCredit(
  userId: number,
  amountEur: number,
  productChanges: { farmId: string; productId: string; amount: number }[],
  description: string,
  now: number,
): Promise<void> {
  await pool.execute(
    `INSERT INTO market_credits (user_id, amount_eur, product_changes_json, description, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, amountEur, JSON.stringify(productChanges), description, now]
  );
}

function calcScore(reputation: number, pricePerUnit: number, maxPrice: number): number {
  const repScore   = Math.pow(Math.max(0, Math.min(100, reputation)) / 100, 0.7);
  const priceScore = Math.max(0, 1 - pricePerUnit / maxPrice);
  return repScore * 0.55 + priceScore * 0.45;
}

// ── 1. Neue Kundenanfragen generieren ─────────────────────────────────────────

async function generateRequests(now: number): Promise<void> {
  for (const [city, merchantIds] of Object.entries(CITY_MERCHANTS)) {
    const profile = CITY_PROFILES[city] ?? { priceMultiplier: 1.0, requestsPerRound: 3, quantityMultiplier: 1.0 };

    const [countRow]: any = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM market_requests WHERE city = ? AND status = "open" AND expires_at > ?',
      [city, now]
    );
    const existing  = Number(countRow[0]?.cnt ?? 0);
    const toGenerate = Math.min(profile.requestsPerRound, MAX_REQUESTS_PER_CITY - existing);
    if (toGenerate <= 0) continue;

    for (let i = 0; i < toGenerate; i++) {
      const merchantId = merchantIds[Math.floor(Math.random() * merchantIds.length)];
      const mDemand    = MERCHANT_DEMAND[merchantId] as Record<string, number> | undefined;
      if (!mDemand) continue;

      const products = Object.keys(mDemand).filter(k => k !== 'default' && mDemand[k] > 0);
      if (products.length === 0) continue;

      const productId = products[Math.floor(Math.random() * products.length)];
      const basePrice = getMerchantPrice(merchantId, productId);
      if (basePrice <= 0) continue;

      // Menge: Stadtprofil skaliert die Zufallsspanne
      const [qMin, qMax] = QTY_RANGE[productId] ?? [50, 500];
      const scaledMin  = Math.round(qMin * profile.quantityMultiplier);
      const scaledMax  = Math.round(qMax * profile.quantityMultiplier);
      const quantity   = Math.max(scaledMin, Math.floor(scaledMin + Math.random() * (scaledMax - scaledMin)));

      // Max-Preis: Stadtcharakter + kleiner Zufallsaufschlag
      const maxPrice = basePrice * profile.priceMultiplier * (1.02 + Math.random() * 0.06);

      await pool.execute(
        `INSERT INTO market_requests (city, merchant_id, product_id, quantity, max_price_per_unit, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [city, merchantId, productId, quantity, maxPrice, now + REQUEST_LIFETIME_MS, now]
      );
    }
  }
}

// ── 2. Abgelaufene Anfragen matchen ───────────────────────────────────────────

async function processBids(now: number): Promise<void> {
  const [requests]: any = await pool.execute(
    'SELECT * FROM market_requests WHERE status = "open" AND expires_at <= ?',
    [now]
  );

  for (const req of requests) {
    const [bids]: any = await pool.execute(
      'SELECT * FROM market_bids WHERE request_id = ? AND status = "pending" ORDER BY created_at ASC',
      [req.id]
    );

    if (bids.length === 0) {
      await pool.execute('UPDATE market_requests SET status = "expired" WHERE id = ?', [req.id]);
      continue;
    }

    // Reputation für alle Bieter laden
    const userIds = Array.from(new Set<number>(bids.map((b: any) => b.user_id as number)));
    const repMap: Record<number, number> = {};
    for (const uid of userIds) repMap[uid] = await getReputation(uid, req.city);

    // Scores berechnen und sortieren
    const scored = bids.map((b: any) => ({
      ...b,
      score: calcScore(repMap[b.user_id] ?? 10, b.price_per_unit, req.max_price_per_unit),
    })).sort((a: any, b: any) => b.score - a.score);

    let remaining  = req.quantity;
    let anyWinner  = false;

    for (const bid of scored) {
      if (remaining <= 0) break;
      const filled = Math.min(bid.quantity_offered, remaining);
      const earned = Math.round(filled * bid.price_per_unit);

      await pool.execute(
        'UPDATE market_bids SET status = "won", score = ? WHERE id = ?',
        [bid.score, bid.id]
      );

      // Credit: Geld gutschreiben + Ware aus Lager abziehen
      await createCredit(
        bid.user_id,
        earned,
        [{ farmId: bid.farm_id, productId: req.product_id, amount: -filled }],
        `${req.merchant_id} · ${req.city}`,
        now,
      );
      await upsertReputation(bid.user_id, req.city, 0.5);

      remaining -= filled;
      anyWinner  = true;
    }

    // Verlierer updaten
    for (const bid of scored) {
      await pool.execute(
        'UPDATE market_bids SET score = ?, status = CASE WHEN status = "pending" THEN "lost" ELSE status END WHERE id = ?',
        [bid.score, bid.id]
      );
    }

    await pool.execute(
      'UPDATE market_requests SET status = ? WHERE id = ?',
      [anyWinner ? 'filled' : 'expired', req.id]
    );
  }
}

// ── 3. Hofladen (unverändert) ─────────────────────────────────────────────────

async function processHofladen(now: number): Promise<void> {
  const [stateRows]: any = await pool.execute(
    'SELECT user_id, state_json FROM game_states'
  );

  for (const row of stateRows) {
    try {
      const state = JSON.parse(row.state_json);
      if (!state.hofladen || typeof state.hofladen !== 'object') continue;

      for (const [farmId, config] of Object.entries(state.hofladen as Record<string, any>)) {
        if (!config.unlocked || !Array.isArray(config.offers) || config.offers.length === 0) continue;

        const meta = (state.farmMeta as any[])?.find((m: any) => m.id === farmId);
        if (!meta) continue;
        const cityId = farmId.includes('_') && /\d{10,}$/.test(farmId)
          ? farmId.replace(/_\d+$/, '') : farmId;

        const rep     = await getReputation(row.user_id, cityId);
        const traffic = Math.floor(20 + rep * 2);
        const farm    = state.farms?.[farmId];
        if (!farm?.storage) continue;

        const changes: { farmId: string; productId: string; amount: number }[] = [];
        let totalEarned = 0;

        for (const offer of config.offers) {
          const { productId, pricePerUnit, limitPerRound } = offer;
          const available = Math.floor(farm.storage[productId] ?? 0);
          if (available <= 0 || pricePerUnit <= 0) continue;

          const basePrc    = BASE_PRICES[productId] ?? 0;
          if (basePrc <= 0) continue;
          const ratio      = pricePerUnit / basePrc;
          const elasticity = Math.max(0.05, 1 - Math.max(0, ratio - 1.2) * 2);
          const cap        = Math.min(limitPerRound ?? traffic, Math.floor(traffic * elasticity));
          const sold       = Math.min(available, cap);
          if (sold <= 0) continue;

          totalEarned += Math.round(sold * pricePerUnit);
          changes.push({ farmId, productId, amount: -sold });
        }

        if (totalEarned > 0) {
          await createCredit(row.user_id, totalEarned, changes, `Hofladen · ${meta.city}`, now);
          await upsertReputation(row.user_id, cityId, 1.0);
        }
      }
    } catch (e) {
      console.error(`[Market] Hofladen-Fehler user=${row.user_id}:`, e);
    }
  }
}

// ── Haupt-Einstiegspunkt ──────────────────────────────────────────────────────

export async function runMatchingRound(): Promise<void> {
  const now = Date.now();
  try {
    await generateRequests(now);
    await processBids(now);
    await processHofladen(now);
    console.log(`[Market] Runde um ${new Date(now).toLocaleTimeString('de-DE')}`);
  } catch (err) {
    console.error('[Market] Fehler:', err);
  }
}
