import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Unser IIS/ARR-Reverse-Proxy liefert 'X-Forwarded-For' mit angehängtem Port
// (z.B. "176.1.204.141:34683"), was express-rate-limits eingebaute IP-Validierung
// ablehnt (ERR_ERL_INVALID_IP_ADDRESS). Ein eigener keyGenerator umgeht diese
// Validierung und kappt den Port selbst, statt uns auf ein bestimmtes Proxy-Format
// zu verlassen.
function ipKeyGenerator(req: Request): string {
  const ip = req.ip ?? 'unknown';
  const ipv4WithPort = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/;
  const match = ip.match(ipv4WithPort);
  return match ? match[1] : ip;
}

// Login: genug Versuche für Tippfehler, aber eng genug um Brute-Force auszubremsen.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Zu viele Anmeldeversuche — bitte in ein paar Minuten erneut versuchen' },
});

// Registrierung: verhindert automatisiertes Massen-Anlegen von Accounts pro IP.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Zu viele Registrierungen von dieser IP — bitte später erneut versuchen' },
});

// Markt-Gebote: schützt vor Spam gegen die Bid-Endpunkte, ohne normales Spielen zu stören.
export const marketWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Zu viele Markt-Anfragen — bitte kurz warten' },
});

// Verifizierungs-Mail erneut anfordern: verhindert, dass der Endpunkt zum Mail-Spam
// gegen fremde Adressen missbraucht wird.
export const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { error: 'Zu viele Anfragen — bitte in ein paar Minuten erneut versuchen' },
});
