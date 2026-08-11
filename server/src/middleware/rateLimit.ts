import rateLimit from 'express-rate-limit';

// Login: genug Versuche für Tippfehler, aber eng genug um Brute-Force auszubremsen.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche — bitte in ein paar Minuten erneut versuchen' },
});

// Registrierung: verhindert automatisiertes Massen-Anlegen von Accounts pro IP.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Registrierungen von dieser IP — bitte später erneut versuchen' },
});

// Markt-Gebote: schützt vor Spam gegen die Bid-Endpunkte, ohne normales Spielen zu stören.
export const marketWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Markt-Anfragen — bitte kurz warten' },
});

// Verifizierungs-Mail erneut anfordern: verhindert, dass der Endpunkt zum Mail-Spam
// gegen fremde Adressen missbraucht wird.
export const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen — bitte in ein paar Minuten erneut versuchen' },
});
