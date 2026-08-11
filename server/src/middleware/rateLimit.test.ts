import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { loginLimiter, registerLimiter, marketWriteLimiter } from './rateLimit';

function appWith(limiter: express.RequestHandler) {
  const app = express();
  app.post('/test', limiter, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function fireRequests(app: express.Express, count: number) {
  const responses = [];
  for (let i = 0; i < count; i++) {
    responses.push(await request(app).post('/test'));
  }
  return responses;
}

// Each limiter below is exercised in exactly one test — they are shared, stateful
// module singletons (like in the real server), so tests for the same limiter would
// interfere with each other's quota if split up.

describe('loginLimiter', () => {
  it('allows up to 10 requests per window, then blocks with a German error message', async () => {
    const app = appWith(loginLimiter);
    const allowed = await fireRequests(app, 10);
    for (const res of allowed) expect(res.status).toBe(200);

    const blocked = await request(app).post('/test');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Zu viele Anmeldeversuche/);
  });
});

describe('registerLimiter', () => {
  it('allows up to 5 requests per window, then blocks with a German error message', async () => {
    const app = appWith(registerLimiter);
    const allowed = await fireRequests(app, 5);
    for (const res of allowed) expect(res.status).toBe(200);

    const blocked = await request(app).post('/test');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Zu viele Registrierungen/);
  });
});

describe('marketWriteLimiter', () => {
  it('allows up to 30 requests per window, then blocks with a German error message', async () => {
    const app = appWith(marketWriteLimiter);
    const allowed = await fireRequests(app, 30);
    for (const res of allowed) expect(res.status).toBe(200);

    const blocked = await request(app).post('/test');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Zu viele Markt-Anfragen/);
  });
});
