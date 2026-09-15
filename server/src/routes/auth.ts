import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db';
import { signToken } from '../middleware/auth';
import {
  loginLimiter, registerLimiter, resendVerificationLimiter, forgotPasswordLimiter, resetPasswordLimiter,
} from '../middleware/rateLimit';
import { sendVerificationEmail, sendPasswordResetEmail } from '../mail';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TOKEN_TTL_MS   = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function generateVerificationToken(): { token: string; expiresAt: number } {
  return { token: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + VERIFICATION_TOKEN_TTL_MS };
}

// Reset-Tokens erlauben eine Kontoübernahme, darum liegt in der DB nur ihr SHA-256 —
// ein DB-Leak allein reicht so nicht, um fremde Passwörter zu setzen.
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
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

// POST /api/auth/forgot-password
// Verschickt einen einmalig nutzbaren Link zum Neusetzen des Passworts (1 Stunde gültig).
router.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response) => {
  const { login } = req.body ?? {};
  if (typeof login !== 'string' || !login.trim())
    return res.status(400).json({ error: 'Benutzername oder E-Mail erforderlich' });

  try {
    const trimmed = login.trim();
    const [rows]: any = await pool.execute(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [trimmed, trimmed.toLowerCase()]
    );
    const user = rows[0];
    // Immer die gleiche Antwort — kein Leak, ob der Account existiert.
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.execute(
        'UPDATE users SET password_reset_token_hash = ?, password_reset_token_expires_at = ? WHERE id = ?',
        [hashResetToken(token), Date.now() + PASSWORD_RESET_TOKEN_TTL_MS, user.id]
      );
      await sendPasswordResetEmail(user.email, user.username, token);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

// POST /api/auth/reset-password
// Setzt das neue Passwort und loggt direkt ein. Wer den Link aus der Mail hat, hat damit
// auch die Adresse bestätigt — ein noch unbestätigter Account wird dabei gleich mit verifiziert.
router.post('/reset-password', resetPasswordLimiter, async (req: Request, res: Response) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== 'string' || !token)
    return res.status(400).json({ error: 'Kein Token übermittelt' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });

  try {
    const tokenHash = hashResetToken(token);
    const [rows]: any = await pool.execute(
      'SELECT id, username, password_reset_token_expires_at FROM users WHERE password_reset_token_hash = ? LIMIT 1',
      [tokenHash]
    );
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Ungültiger oder bereits benutzter Link' });
    if (Number(user.password_reset_token_expires_at) < Date.now()) {
      return res.status(400).json({ error: 'Link ist abgelaufen — bitte neuen anfordern' });
    }

    const hash = await bcrypt.hash(password, 12);
    // Token-Hash in der WHERE-Klausel: bei zwei gleichzeitigen Requests mit demselben
    // Link gewinnt nur einer, der Token ist danach verbraucht.
    const [result]: any = await pool.execute(
      `UPDATE users SET password_hash = ?, password_reset_token_hash = NULL, password_reset_token_expires_at = NULL,
         email_verified = 1, verification_token = NULL, verification_token_expires_at = NULL
       WHERE id = ? AND password_reset_token_hash = ?`,
      [hash, user.id, tokenHash]
    );
    if (result.affectedRows !== 1) return res.status(400).json({ error: 'Ungültiger oder bereits benutzter Link' });

    const jwt = signToken({ userId: user.id, username: user.username });
    return res.json({ token: jwt, username: user.username });
  } catch (err) {
    console.error('[reset-password]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
