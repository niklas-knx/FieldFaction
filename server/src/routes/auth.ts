import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import { signToken } from '../middleware/auth';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
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
    const [result]: any = await pool.execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email.toLowerCase(), hash]
    );
    const userId: number = result.insertId;
    const token = signToken({ userId, username });
    return res.status(201).json({ token, username });
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
      'SELECT id, username, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1',
      [login, login.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });

    const token = signToken({ userId: user.id, username: user.username });
    return res.json({ token, username: user.username });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
