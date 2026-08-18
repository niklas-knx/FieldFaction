import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
  pool: { execute: vi.fn() },
}));

import { pool } from '../db';
import { calcScore, processBids, processHofladenSales, ensureMarketFresh } from './matching';

const execute = pool.execute as unknown as ReturnType<typeof vi.fn>;

function callsMatching(sqlPattern: RegExp): any[][] {
  return execute.mock.calls.filter((call: any[]) => sqlPattern.test(call[0]));
}

function findCall(sqlPattern: RegExp): any[] | undefined {
  return execute.mock.calls.find((call: any[]) => sqlPattern.test(call[0]));
}

// ── calcScore: pure ranking function used to pick bid winners ─────────────────

describe('calcScore', () => {
  it('weights reputation 55% and price advantage 45%', () => {
    const repOnly   = calcScore(100, 10, 10); // price == max -> priceScore 0
    const priceOnly = calcScore(0, 0, 10);     // price 0 -> priceScore 1, rep 0 -> repScore 0
    expect(repOnly).toBeCloseTo(0.55, 5);
    expect(priceOnly).toBeCloseTo(0.45, 5);
  });

  it('gives a higher score to a cheaper bid at equal reputation', () => {
    const cheap      = calcScore(50, 5, 10);
    const expensive  = calcScore(50, 9, 10);
    expect(cheap).toBeGreaterThan(expensive);
  });

  it('gives a higher score to a more reputable bidder at equal price', () => {
    const trusted   = calcScore(80, 5, 10);
    const untrusted = calcScore(5, 5, 10);
    expect(trusted).toBeGreaterThan(untrusted);
  });

  it('clamps price above maxPrice to a zero price-advantage instead of going negative', () => {
    const overpriced = calcScore(50, 15, 10); // price > max
    const atMax       = calcScore(50, 10, 10);
    expect(overpriced).toBeCloseTo(atMax, 10);
  });

  it('clamps out-of-range reputation into [0, 100]', () => {
    expect(calcScore(150, 5, 10)).toBeCloseTo(calcScore(100, 5, 10), 10);
    expect(calcScore(-10, 5, 10)).toBeCloseTo(calcScore(0, 5, 10), 10);
  });
});

// ── processBids: winner selection, partial fills, reputation/credit side effects ──

describe('processBids', () => {
  const now = 1_000_000;

  const request = {
    id: 1, city: 'muenchen', merchant_id: 'baecker', product_id: 'wheat',
    quantity: 100, max_price_per_unit: 10, status: 'open', expires_at: now - 1,
  };

  // Highest score: good reputation, mid price
  const bidHighScore = { id: 10, request_id: 1, user_id: 1, farm_id: 'muenchen', price_per_unit: 8, quantity_offered: 60, status: 'pending', created_at: 1 };
  // Middle score: low reputation, cheap price
  const bidMidScore  = { id: 11, request_id: 1, user_id: 2, farm_id: 'muenchen', price_per_unit: 9, quantity_offered: 80, status: 'pending', created_at: 2 };
  // Lowest score: no reputation, priced near the max -> should lose out entirely
  const bidLowScore  = { id: 12, request_id: 1, user_id: 3, farm_id: 'muenchen', price_per_unit: 9.99, quantity_offered: 5, status: 'pending', created_at: 3 };

  const reputationByUser: Record<number, number> = { 1: 50, 2: 10, 3: 0 };

  function installMock(requests: any[], bids: any[]) {
    execute.mockImplementation(async (sql: string, params: any[] = []) => {
      if (/SELECT \* FROM market_requests WHERE status = "open"/.test(sql)) return [requests];
      if (/SELECT \* FROM market_bids WHERE request_id/.test(sql)) return [bids];
      if (/SELECT score FROM market_reputation/.test(sql)) {
        const userId = params[0];
        const score = reputationByUser[userId];
        return [score === undefined ? [] : [{ score }]];
      }
      return [[]];
    });
  }

  beforeEach(() => {
    execute.mockReset();
  });

  it('ranks bids by score, fills the request from best to worst, and stops once quantity is exhausted', async () => {
    installMock([request], [bidHighScore, bidMidScore, bidLowScore]);
    await processBids(now);

    const winCalls = callsMatching(/UPDATE market_bids SET status = "won"/);
    const wonIds = winCalls.map(call => call[1][1]);
    // Request quantity (100) is exhausted by bid 10 (60) + bid 11 (40 of its 80 offered) — bid 12 never reached.
    expect(wonIds.sort()).toEqual([10, 11]);

    const creditCalls = callsMatching(/INSERT INTO market_credits/);
    expect(creditCalls).toHaveLength(2);

    const firstCreditParams = creditCalls[0][1];
    expect(firstCreditParams[0]).toBe(1); // user_id of the highest-score bid
    expect(firstCreditParams[1]).toBe(Math.round(60 * 8)); // filled=60 (its own offer), price 8
    expect(JSON.parse(firstCreditParams[2])).toEqual([{ farmId: 'muenchen', productId: 'wheat', amount: -60 }]);

    const secondCreditParams = creditCalls[1][1];
    expect(secondCreditParams[0]).toBe(2); // second-highest-score bid's user
    // Only 40 of its 80 units are needed to fill the remaining request quantity
    expect(secondCreditParams[1]).toBe(Math.round(40 * 9));
    expect(JSON.parse(secondCreditParams[2])).toEqual([{ farmId: 'muenchen', productId: 'wheat', amount: -40 }]);
  });

  it('marks bids that never got reached as lost', async () => {
    installMock([request], [bidHighScore, bidMidScore, bidLowScore]);
    await processBids(now);

    const loserCalls = callsMatching(/status = CASE WHEN status = "pending" THEN "lost"/);
    const loserIds = loserCalls.map(call => call[1][1]);
    expect(loserIds).toContain(12);
  });

  it('marks the request as filled once at least one bid wins', async () => {
    installMock([request], [bidHighScore]);
    await processBids(now);

    const requestUpdate = findCall(/UPDATE market_requests SET status = \?/);
    expect(requestUpdate?.[1]).toEqual(['filled', 1]);
  });

  it('expires a request with no bids at all without creating any credits', async () => {
    installMock([request], []);
    await processBids(now);

    expect(findCall(/UPDATE market_requests SET status = "expired"/)).toBeTruthy();
    expect(callsMatching(/INSERT INTO market_credits/)).toHaveLength(0);
  });

  it('rewards winning bidders with a small reputation gain', async () => {
    installMock([request], [bidHighScore]);
    await processBids(now);

    const repUpsert = findCall(/INSERT INTO market_reputation/);
    expect(repUpsert?.[1]).toEqual([1, 'muenchen', 0.5, 0.5]);
  });
});

// ── processHofladenSales: rate-based sales out of the offer's own stock ───────

describe('processHofladenSales', () => {
  const now = 1_000_000;
  const userId = 7;

  function installReputationMock(score: number) {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT score FROM market_reputation/.test(sql)) return [[{ score }]];
      return [[]];
    });
  }

  function baseState(stock: number, pricePerUnit: number) {
    return {
      money: 1000,
      farmMeta: [{ id: 'muenchen', city: 'München' }],
      farms: { muenchen: { storage: {} } },
      hofladen: {
        muenchen: {
          unlocked: true,
          offers: [{ productId: 'eggs', pricePerUnit, stock }],
        },
      },
    };
  }

  it('sells proportionally to elapsed time and reputation-based traffic, crediting money directly', async () => {
    installReputationMock(10); // traffic = 20 + 10*2 = 40 units/min
    const state = baseState(100, 0.35); // priced at base -> elasticity 1

    const result = await processHofladenSales(userId, state, 60, now); // 1 minute elapsed

    const offer = result.hofladen.muenchen.offers[0];
    expect(offer.stock).toBe(60); // 100 - 40 sold
    expect(result.money).toBe(1000 + Math.round(40 * 0.35));
  });

  it('never sells more than what is stocked', async () => {
    installReputationMock(10);
    const state = baseState(5, 0.35);

    const result = await processHofladenSales(userId, state, 60, now);

    expect(result.hofladen.muenchen.offers[0].stock).toBe(0);
    expect(result.money).toBe(1000 + Math.round(5 * 0.35));
  });

  it('grants a reputation bump only when something actually sold', async () => {
    installReputationMock(10);
    const state = baseState(100, 0.35);

    await processHofladenSales(userId, state, 60, now);
    const repUpsert = findCall(/INSERT INTO market_reputation/);
    expect(repUpsert?.[1]).toEqual([userId, 'muenchen', 1.0, 1.0]);
  });

  it('does nothing when no time has elapsed or stock is empty', async () => {
    installReputationMock(10);
    const state = baseState(0, 0.35);

    const result = await processHofladenSales(userId, state, 60, now);
    expect(result.money).toBe(1000);
    expect(execute).not.toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO market_reputation/), expect.anything());
  });

  it('normalizes legacy offers without a stock field (pre-migration saves) to 0 instead of NaN, even with zero elapsed time', async () => {
    installReputationMock(10);
    const state = {
      money: 1000,
      farmMeta: [{ id: 'muenchen', city: 'München' }],
      farms: { muenchen: { storage: {} } },
      hofladen: {
        muenchen: {
          unlocked: true,
          // Alte Form vor dem Stock-Modell: limitPerRound statt stock.
          offers: [{ productId: 'eggs', pricePerUnit: 0.35, limitPerRound: 30 }],
        },
      },
    };

    // elapsedSeconds = 0 simuliert zwei Aktionen innerhalb derselben Sekunde.
    const result = await processHofladenSales(userId, state, 0, now);

    const stock = result.hofladen.muenchen.offers[0].stock;
    expect(stock).toBe(0);
    expect(Number.isNaN(stock)).toBe(false);
  });
});

// ── ensureMarketFresh / generateRequests: erster Aufruf pro Stadt darf nicht auf ewig ──
// 0 Anfragen hängen bleiben (Regression: lastGenAt fiel beim ersten Mal auf "jetzt" statt
// "vor 60s" zurück -> elapsedMs immer 0 -> nie generiert, siehe matching.ts).

describe('ensureMarketFresh', () => {
  it('generates merchant requests on the very first sweep for a city instead of computing zero elapsed time', async () => {
    execute.mockReset();
    const insertedRequests: any[] = [];
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT COUNT\(\*\) AS cnt FROM market_requests/.test(sql)) return [[{ cnt: 0 }]];
      if (/INSERT INTO market_requests/.test(sql)) { insertedRequests.push(sql); return [{}]; }
      if (/SELECT \* FROM market_requests WHERE status = "open"/.test(sql)) return [[]]; // processBids: nichts abgelaufen
      return [[]];
    });

    // now ist beliebig, muss nur groß genug für "now - 60_000 >= 0" sein.
    await ensureMarketFresh(10_000_000);

    expect(insertedRequests.length).toBeGreaterThan(0);
  });
});
