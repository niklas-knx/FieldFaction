import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';

vi.mock('../db', () => ({ pool: { execute: vi.fn() } }));
vi.mock('../mail', () => ({ sendVerificationEmail: vi.fn() }));

import { pool } from '../db';
import { sendVerificationEmail } from '../mail';
import authRoutes from './auth';

const execute = pool.execute as unknown as ReturnType<typeof vi.fn>;
const sendMail = sendVerificationEmail as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

function findCall(sqlPattern: RegExp): any[] | undefined {
  return execute.mock.calls.find((call: any[]) => sqlPattern.test(call[0]));
}

beforeEach(() => {
  execute.mockReset();
  sendMail.mockReset();
  process.env.JWT_SECRET = 'test-secret-at-least-this-long-for-signing-1234567890';
});

describe('POST /api/auth/register', () => {
  it('creates an unverified account, emails a token, and does not return a JWT', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/INSERT INTO users/.test(sql)) return [{ insertId: 1 }];
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'newbie', email: 'newbie@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ requiresVerification: true, email: 'newbie@example.com' });
    expect(res.body.token).toBeUndefined();

    const insertCall = findCall(/INSERT INTO users/);
    expect(insertCall).toBeTruthy();
    const [, params] = insertCall!;
    expect(params[0]).toBe('newbie');
    expect(params[1]).toBe('newbie@example.com');
    expect(typeof params[3]).toBe('string'); // verification_token
    expect(params[3]).toHaveLength(64); // crypto.randomBytes(32).toString('hex')

    expect(sendMail).toHaveBeenCalledWith('newbie@example.com', 'newbie', params[3]);
  });

  it('rejects a duplicate username/email with 409', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/INSERT INTO users/.test(sql)) {
        const err: any = new Error("Duplicate entry 'newbie' for key 'users.username'");
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'newbie', email: 'newbie@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects an invalid email format before touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'newbie', email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  it('blocks login for an unverified account', async () => {
    const hash = await bcrypt.hash('password123', 4);
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, password_hash, email_verified/.test(sql)) {
        return [[{ id: 1, username: 'newbie', password_hash: hash, email_verified: 0 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ login: 'newbie', password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_not_verified');
  });

  it('logs in a verified account with the correct password', async () => {
    const hash = await bcrypt.hash('password123', 4);
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, password_hash, email_verified/.test(sql)) {
        return [[{ id: 1, username: 'newbie', password_hash: hash, email_verified: 1 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ login: 'newbie', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('newbie');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects an incorrect password', async () => {
    const hash = await bcrypt.hash('password123', 4);
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, password_hash, email_verified/.test(sql)) {
        return [[{ id: 1, username: 'newbie', password_hash: hash, email_verified: 1 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ login: 'newbie', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/verify', () => {
  it('verifies a valid token and returns a login JWT', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, verification_token_expires_at/.test(sql)) {
        return [[{ id: 1, username: 'newbie', verification_token_expires_at: Date.now() + 60_000 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/verify')
      .send({ token: 'a-valid-token' });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('newbie');
    expect(typeof res.body.token).toBe('string');

    const updateCall = findCall(/UPDATE users SET email_verified = 1/);
    expect(updateCall).toBeTruthy();
  });

  it('rejects an expired token', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, verification_token_expires_at/.test(sql)) {
        return [[{ id: 1, username: 'newbie', verification_token_expires_at: Date.now() - 1000 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/verify')
      .send({ token: 'an-expired-token' });

    expect(res.status).toBe(400);
    expect(findCall(/UPDATE users SET email_verified = 1/)).toBeFalsy();
  });

  it('rejects an unknown token', async () => {
    execute.mockImplementation(async () => [[]]);

    const res = await request(buildApp())
      .post('/api/auth/verify')
      .send({ token: 'does-not-exist' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('regenerates the token and resends the email for an unverified account', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, email, email_verified/.test(sql)) {
        return [[{ id: 1, username: 'newbie', email: 'newbie@example.com', email_verified: 0 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ login: 'newbie' });

    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toBe('newbie@example.com');
  });

  it('responds identically for a non-existent account (no user enumeration)', async () => {
    execute.mockImplementation(async () => [[]]);

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ login: 'ghost' });

    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not resend for an already-verified account', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, username, email, email_verified/.test(sql)) {
        return [[{ id: 1, username: 'newbie', email: 'newbie@example.com', email_verified: 1 }]];
      }
      return [[]];
    });

    const res = await request(buildApp())
      .post('/api/auth/resend-verification')
      .send({ login: 'newbie' });

    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
