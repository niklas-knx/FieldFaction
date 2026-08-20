import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// getConnection() returns a fake connection whose execute() is the SAME mock fn as
// pool.execute — so existing SQL-pattern mocking below (installSavedState etc.) keeps
// working unchanged, transactions are just no-ops in this in-memory test double.
vi.mock('../db', () => {
  const execute = vi.fn();
  const conn = {
    execute,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return { pool: { execute, getConnection: vi.fn(async () => conn) } };
});
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 1, username: 'tester' };
    next();
  },
}));

import { pool } from '../db';
import gameRoutes from './game';
import { createInitialState } from '../../../src/farm/Farm';

const execute = pool.execute as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/game', gameRoutes);
  return app;
}

// Installs a fake game_states row so loadAndAdvance() finds a "previously saved" state.
// Returns the list of states actually persisted via INSERT (parsed from the real SQL
// params), not the original fixture — so tests can verify what the server computed.
function installSavedState(state: any, lastSavedAt: number) {
  const insertedStates: any[] = [];
  execute.mockImplementation(async (sql: string, params: any[] = []) => {
    if (/SELECT state_json/.test(sql)) {
      return [[{ state_json: JSON.stringify(state), save_version: 11, last_saved_at: lastSavedAt }]];
    }
    if (/INSERT INTO game_states/.test(sql)) {
      insertedStates.push(JSON.parse(params[2]));
      return [{}];
    }
    return [[]];
  });
  return insertedStates;
}

function installNoSavedState() {
  const insertedStates: any[] = [];
  execute.mockImplementation(async (sql: string, params: any[] = []) => {
    if (/SELECT state_json/.test(sql)) return [[]];
    if (/INSERT INTO game_states/.test(sql)) {
      insertedStates.push(JSON.parse(params[2]));
      return [{}];
    }
    return [[]];
  });
  return insertedStates;
}

beforeEach(() => execute.mockReset());

describe('GET /api/game/state', () => {
  it('reports newGame without a state and without persisting anything for a fresh account', async () => {
    installNoSavedState();

    const res = await request(buildApp()).get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.newGame).toBe(true);
    expect(res.body.state).toBeUndefined();

    const insertCall = execute.mock.calls.find((c: any[]) => /INSERT INTO game_states/.test(c[0]));
    expect(insertCall).toBeFalsy();
  });

  it('advances an existing state by the real elapsed time since the last save', async () => {
    const saved = createInitialState();
    installSavedState(saved, Date.now() - 5_000); // 5 real seconds ago

    const res = await request(buildApp()).get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.newGame).toBe(false);
    expect(res.body.state.tick).toBeGreaterThanOrEqual(5);
    expect(res.body.offlineSeconds).toBeGreaterThanOrEqual(5);
  });

  it('normalizes a save from before the credit system (missing debt field) to 0 instead of rejecting it', async () => {
    const saved: any = createInitialState();
    delete saved.debt; // Spielstand von vor takeLoan/repayLoan
    // 0 Sekunden seit dem letzten Speichern: advanceState() läuft 0 Ticks, tickGame() greift
    // also nicht — die Normalisierung muss unabhängig davon in loadAndAdvance() passieren.
    installSavedState(saved, Date.now());

    const res = await request(buildApp()).get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.state.debt).toBe(0);
  });

  it('reports the money earned since the last save, broken down by source (fürs Willkommen-zurück-Popup)', async () => {
    const saved = createInitialState();
    const startMoney = saved.money;
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT state_json/.test(sql)) {
        return [[{ state_json: JSON.stringify(saved), save_version: 11, last_saved_at: Date.now() }]];
      }
      if (/SELECT id, amount_eur, product_changes_json, description FROM market_credits/.test(sql)) {
        return [[{ id: 1, amount_eur: 250, product_changes_json: '[]', description: 'baecker · muenchen' }]];
      }
      if (/UPDATE market_credits SET applied/.test(sql)) return [{}];
      if (/INSERT INTO game_states/.test(sql)) return [{}];
      return [[]];
    });

    const res = await request(buildApp()).get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.earnings.credits).toBe(250);
    expect(res.body.earnings.hofladen).toBe(0);
    expect(res.body.earnings.total).toBe(250);
    expect(res.body.state.money).toBe(startMoney + 250);
  });
});

describe('POST /api/game/action', () => {
  it('rejects unknown action types without touching the database', async () => {
    installNoSavedState();

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'deleteAllUsers', args: [] });

    expect(res.status).toBe(400);
    const insertCall = execute.mock.calls.find((c: any[]) => /INSERT INTO game_states/.test(c[0]));
    expect(insertCall).toBeFalsy();
  });

  it('wraps the whole load-apply-persist cycle in a single transaction (regression: double-collect race)', async () => {
    // Zwei nahezu gleichzeitige Requests desselben Nutzers (z.B. zwei Geräte) dürfen nicht
    // beide denselben Stand lesen, bevor der jeweils andere committet hat — sonst könnten
    // beide z.B. denselben Stall-Ertrag einlagern. Da hier die DB gemockt ist, prüft dieser
    // Test nur die Verdrahtung (BEGIN/COMMIT je Aktion), nicht die echte MySQL-Zeilensperre.
    const saved = createInitialState();
    saved.farms.muenchen.plots[0].fieldState = 'fallow';
    installSavedState(saved, Date.now());

    const conn = await (pool.getConnection as unknown as () => Promise<any>)();
    conn.beginTransaction.mockClear();
    conn.commit.mockClear();
    conn.rollback.mockClear();
    conn.release.mockClear();

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'tillPlot', args: ['muenchen', 0] });

    expect(res.status).toBe(200);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('applies an allowed action server-side and persists the result', async () => {
    const saved = createInitialState();
    saved.farms.muenchen.plots[0].fieldState = 'fallow';
    const insertedStates = installSavedState(saved, Date.now());

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'tillPlot', args: ['muenchen', 0] });

    expect(res.status).toBe(200);
    expect(res.body.state.farms.muenchen.plots[0].fieldState).toBe('being_tilled');
    expect(insertedStates).toHaveLength(1);
    expect(insertedStates[0].farms.muenchen.plots[0].fieldState).toBe('being_tilled');
  });

  it('forwards the rejection notification when an action fails its own preconditions', async () => {
    const saved = createInitialState();
    saved.farms.muenchen.plots[0].fieldState = 'fallow';
    saved.vehicles = []; // no tractor -> tillPlot must refuse and emit a notification
    installSavedState(saved, Date.now());

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'tillPlot', args: ['muenchen', 0] });

    expect(res.status).toBe(200);
    expect(res.body.state.farms.muenchen.plots[0].fieldState).toBe('fallow'); // unchanged
    expect(res.body.notifications).toEqual(
      expect.arrayContaining([expect.stringContaining('Kein freier Traktor')])
    );
  });

  it('rejects a non-array args payload', async () => {
    installNoSavedState();

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'tillPlot', args: 'muenchen' });

    expect(res.status).toBe(400);
  });

  it('rejects with 409 when the account has not chosen a starting location yet', async () => {
    installNoSavedState();

    const res = await request(buildApp())
      .post('/api/game/action')
      .send({ type: 'tillPlot', args: ['muenchen', 0] });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/game/start', () => {
  it('creates a game state at the chosen location for a fresh account', async () => {
    const insertedStates = installNoSavedState();

    const res = await request(buildApp())
      .post('/api/game/start')
      .send({ city: 'Hamburg', farmName: 'Hof Elbe', lat: 53.55, lon: 9.99 });

    expect(res.status).toBe(200);
    expect(res.body.state.activeFarmId).toMatch(/^hamburg_/);
    expect(res.body.state.farmMeta).toHaveLength(1);
    expect(res.body.state.farmMeta[0]).toMatchObject({
      name: 'Hof Elbe', city: 'Hamburg', lat: 53.55, lon: 9.99, unlocked: true, unlockCost: 0,
    });
    expect(Object.keys(res.body.state.farms)).toEqual([res.body.state.activeFarmId]);
    expect(insertedStates).toHaveLength(1);
  });

  it('defaults the farm name when none is given', async () => {
    installNoSavedState();

    const res = await request(buildApp())
      .post('/api/game/start')
      .send({ city: 'Köln', lat: 50.94, lon: 6.96 });

    expect(res.status).toBe(200);
    expect(res.body.state.farmMeta[0].name).toBe('Gut Köln');
  });

  it('rejects a missing city or invalid coordinates', async () => {
    installNoSavedState();

    const noCity = await request(buildApp()).post('/api/game/start').send({ lat: 1, lon: 1 });
    expect(noCity.status).toBe(400);

    const badCoords = await request(buildApp())
      .post('/api/game/start')
      .send({ city: 'Berlin', lat: 999, lon: 9 });
    expect(badCoords.status).toBe(400);
  });

  it('is idempotent: ignores the choice and returns the existing state if one already exists', async () => {
    const saved = createInitialState();
    const insertedStates = installSavedState(saved, Date.now());

    const res = await request(buildApp())
      .post('/api/game/start')
      .send({ city: 'Hamburg', farmName: 'Hof Elbe', lat: 53.55, lon: 9.99 });

    expect(res.status).toBe(200);
    expect(res.body.state.activeFarmId).toBe('muenchen'); // unverändert, nicht Hamburg
    expect(insertedStates).toHaveLength(1);
  });
});

describe('DELETE /api/game/state', () => {
  it('deletes the saved state for the authenticated user', async () => {
    const deleteCalls: any[] = [];
    execute.mockImplementation(async (sql: string, params: any[]) => {
      if (/DELETE FROM game_states/.test(sql)) { deleteCalls.push(params); return [{}]; }
      return [[]];
    });

    const res = await request(buildApp()).delete('/api/game/state');
    expect(res.status).toBe(200);
    expect(deleteCalls).toEqual([[1]]);
  });
});
