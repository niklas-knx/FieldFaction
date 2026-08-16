import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { testConnection, initTables, migrateUsersTable } from './db';
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import marketRoutes from './routes/market';
import { runMatchingRound } from './market/matching';

dotenv.config();

const app  = express();
const PORT = Number(process.env.PORT ?? 3001);

// Läuft hinter IIS/ARR als Reverse Proxy (immer auf localhost) — 'loopback' vertraut
// X-Forwarded-For nur, wenn die Verbindung selbst von 127.0.0.1 kommt, siehe
// https://express-rate-limit.github.io/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/
app.set('trust proxy', 'loopback');
const MATCHING_INTERVAL_MS = 60_000; // 60 Sekunden

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  // Deaktiviert: würde das von uns selbst ausgelieferte Frontend-Bundle blockieren,
  // ohne dass wir aktuell eine echte CSP-Policy pflegen.
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/market', marketRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Frontend (Production) ─────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '../../dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  await testConnection();
  console.log('[DB] MySQL-Verbindung OK');
  try {
    await initTables();
    console.log('[DB] Markttabellen bereit');
  } catch (e: any) {
    // Tabellen wurden manuell angelegt oder User hat keine CREATE-Rechte — OK
    console.warn('[DB] initTables übersprungen:', e.sqlMessage ?? e.message);
  }
  try {
    await migrateUsersTable();
    console.log('[DB] users-Tabelle auf E-Mail-Verifizierung migriert');
  } catch (e: any) {
    console.warn('[DB] migrateUsersTable übersprungen:', e.sqlMessage ?? e.message);
  }

  // Markt-Matching alle 60 Sekunden
  setInterval(() => {
    runMatchingRound().catch(err => console.error('[Market] Unhandled error:', err));
  }, MATCHING_INTERVAL_MS);
  console.log(`[Market] Matching-Loop gestartet (alle ${MATCHING_INTERVAL_MS / 1000}s)`);

  app.listen(PORT, () => console.log(`[Server] läuft auf http://localhost:${PORT}`));
}

main().catch(err => {
  console.error('[Server] Startfehler:', err);
  process.exit(1);
});
