import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db';
import { signToken } from '../middleware/auth';
import { loginLimiter, registerLimiter, resendVerificationLimiter } from '../middleware/rateLimit';
import { sendVerificationEmail } from '../mail';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function generateVerificationToken(): { token: string; expiresAt: number } {
  return { token: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + VERIFICATION_TOKEN_TTL_MS };
}

// POST /api/auth/register
// Legt den Account an, aber noch nicht verifiziert — kein JWT, sondern ein
// Bestätigungslink per Mail. Login ist erst nach Klick auf den Link möglich (siehe /verify).
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const { username, email, password } = req.body ?? {};

  if (!USERNAME_RE.test(username ?? ''))
    return res.status(400).json({ error: 'Benutzername: 3–30 Zeichen, nur Buchstaben/Zahlen/_' });
  if (!EMAIL_RE.test(email ?? ''))
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { token, expiresAt } = generateVerificationToken();
    const normalizedEmail = email.toLowerCase();
    await pool.execute(
      `INSERT INTO users (username, email, password_hash, verification_token, verification_token_expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, normalizedEmail, hash, token, expiresAt]
    );
    await sendVerificationEmail(normalizedEmail, username, token);
    return res.status(201).json({ requiresVerification: true, email: normalizedEmail });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      const field = err.message.includes('username') ? 'Benutzername' : 'E-Mail';
      return res.status(409).json({ error: `${field} bereits vergeben` });
    }
    console.error('[register]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { login, password } = req.body ?? {};  // login = username oder email

  if (!login || !password)
    return res.status(400).json({ error: 'Benutzername/E-Mail und Passwort erforderlich' });

  try {
    const [rows]: any = await pool.execute(
      'SELECT id, username, password_hash, email_verified FROM users WHERE username = ? OR email = ? LIMIT 1',
      [login, login.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });

    if (!user.email_verified) {
      return res.status(403).json({ error: 'E-Mail noch nicht bestätigt', code: 'email_not_verified' });
    }

    const token = signToken({ userId: user.id, username: user.username });
    return res.json({ token, username: user.username });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/auth/verify
// Klick auf den Bestätigungslink — bestätigt die E-Mail und loggt direkt ein.
router.post('/verify', async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Kein Token übermittelt' });
  }

  try {
    const [rows]: any = await pool.execute(
      'SELECT id, username, verification_token_expires_at FROM users WHERE verification_token = ? LIMIT 1',
      [token]
    );
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Ungültiger Bestätigungslink' });
    if (Number(user.verification_token_expires_at) < Date.now()) {
      return res.status(400).json({ error: 'Bestätigungslink ist abgelaufen — bitte neuen anfordern' });
    }

    await pool.execute(
      'UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires_at = NULL WHERE id = ?',
      [user.id]
    );

    const jwt = signToken({ userId: user.id, username: user.username });
    return res.json({ token: jwt, username: user.username });
  } catch (err) {
    console.error('[verify]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', resendVerificationLimiter, async (req: Request, res: Response) => {
  const { login } = req.body ?? {};
  if (!login) return res.status(400).json({ error: 'Benutzername oder E-Mail erforderlich' });

  try {
    const [rows]: any = await pool.execute(
      'SELECT id, username, email, email_verified FROM users WHERE username = ? OR email = ? LIMIT 1',
      [login, String(login).toLowerCase()]
    );
    const user = rows[0];
    // Immer die gleiche Antwort — kein Leak, ob der Account existiert oder schon verifiziert ist.
    if (user && !user.email_verified) {
      const { token, expiresAt } = generateVerificationToken();
      await pool.execute(
        'UPDATE users SET verification_token = ?, verification_token_expires_at = ? WHERE id = ?',
        [token, expiresAt, user.id]
      );
      await sendVerificationEmail(user.email, user.username, token);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[resend-verification]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
