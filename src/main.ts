import { FarmUI } from './ui/FarmUI';
import type { WelcomeBackSummary } from './ui/FarmUI';
import { LandingUI } from './ui/LandingUI';
import { StartLocationUI } from './ui/StartLocationUI';
import type { GameState } from './types';
import type { TickEvents } from './farm/Farm';
import { PRODUCTS, formatAmount } from './data/products';
import { EMPLOYEE_ROLES } from './data/employees';
import { bus } from './core/EventBus';
import { apiLoadState, apiStartGame, apiVerifyEmail, isLoggedIn, logout, type LoadResult } from './api';
import './style.css';
import 'leaflet/dist/leaflet.css';

// Seit Issue #7 ist der Server die alleinige Quelle der Wahrheit für den Spielzustand —
// der Client erzeugt keine Ticks mehr selbst (kein lokaler tickGame()-Loop, kein
// Autosave-PUT). Er zeigt nur noch an, was der Server zuletzt berechnet hat, und fragt
// regelmäßig frischen Stand an bzw. löst Aktionen über FarmUI.dispatch() aus.
const SYNC_INTERVAL_MS   = 8_000; // frischen, serverseitig fortgeschriebenen Stand holen
const RENDER_INTERVAL_MS = 1_000; // rein kosmetischer Re-render-Takt für Fortschrittsbalken

const container = document.getElementById('app')!;

let state: GameState;
let ui: FarmUI;

type LoadedResult = Exclude<LoadResult, { isNewGame: true }>;

// ── Update-Funktion (von FarmUI nach jeder serverseitig bestätigten Aktion aufgerufen) ──
const update = (newState: GameState) => {
  state = newState;
  ui.render(state);
};

// ── Offline-Ereignisse: aggregiert statt einzeln gemeldet ─────────────────────
function buildWelcomeBackSummary(
  offlineSeconds: number,
  startPrices: Record<string, number>,
  endPrices: Record<string, number>,
  events: TickEvents,
): WelcomeBackSummary {
  const topPriceMoves = Object.keys(endPrices)
    .map(productId => {
      const fromPrice = startPrices[productId] ?? endPrices[productId];
      const toPrice   = endPrices[productId];
      const pctChange = fromPrice > 0 ? ((toPrice - fromPrice) / fromPrice) * 100 : 0;
      return { productId, fromPrice, toPrice, pctChange };
    })
    .filter(m => Math.abs(m.pctChange) >= 1)
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
    .slice(0, 5);

  return {
    offlineSeconds,
    fieldsHarvested: events.fieldsHarvested,
    stallCollectionsReady: events.stallCollectionsReady,
    processingCompleted: events.processingCompleted,
    deliveriesArrived: events.deliveriesArrived,
    employeesFired: events.employeesFired,
    wagesPaid: events.wagesPaid,
    topPriceMoves,
  };
}

// Ereignisse aus einem regulären Sync können sofort als Notification raus — anders als
// beim Offline-Nachholen (ggf. tausende Ticks auf einmal), wo das spammen würde.
function notifyLiveTickEvents(events: TickEvents): void {
  events.deliveriesArrived.forEach(d => {
    const p = PRODUCTS[d.productId];
    bus.emit('notification', `🚛 ${formatAmount(d.amount, p?.unit ?? '')} ${p?.name ?? d.productId} angekommen`);
  });
  events.employeesFired.forEach(f => {
    const def = EMPLOYEE_ROLES[f.role];
    bus.emit('notification', `💸 ${def?.emoji ?? '👤'} ${def?.name ?? f.role} wegen unbezahlter Löhne gekündigt`);
  });
}

// ── Spiel mit einem bereits geladenen Stand betreten (normaler Login ODER direkt
// nach Wahl des Startorts) ─────────────────────────────────────────────────────
function enterGame(result: LoadedResult): void {
  state = result.state;

  let welcomeBack: WelcomeBackSummary | null = null;
  if (result.offlineSeconds > 0) {
    welcomeBack = buildWelcomeBackSummary(
      result.offlineSeconds, result.previousMarketPrices, state.marketPrices, result.events,
    );
  }

  ui = new FarmUI(container, update);
  ui.bindKeyboard(() => state, update);
  ui.render(state);
  if (welcomeBack) ui.showWelcomeBack(welcomeBack);

  // Rein kosmetischer Re-render-Takt: aktualisiert Fortschrittsbalken/Restzeiten im
  // Sekundentakt, ohne selbst neuen Spielzustand zu erzeugen.
  setInterval(() => ui.render(state, true), RENDER_INTERVAL_MS);

  // Periodischer Sync: holt den serverseitig fortgeschriebenen Stand (Feldwachstum,
  // Tierproduktion, Lieferungen, Löhne, gewonnene Markt-Gebote, …) — Dinge, die ohne
  // eigenes Zutun im Hintergrund passieren.
  setInterval(async () => {
    try {
      const r = await apiLoadState();
      if (r.isNewGame) return; // sollte nach dem ersten Start nie mehr vorkommen
      state = r.state;
      notifyLiveTickEvents(r.events);
      ui.render(state);
    } catch (err) {
      console.warn('[Sync]', err);
    }
  }, SYNC_INTERVAL_MS);
}

// Frisch verifizierter Account ohne Spielstand: Startort wählen lassen, bevor es losgeht.
function showStartLocationPicker(): void {
  const picker = new StartLocationUI(container, async (city, farmName, lat, lon) => {
    try {
      const result = await apiStartGame(city, farmName, lat, lon);
      enterGame(result);
    } catch (err: any) {
      picker.showError(err.message ?? 'Standort konnte nicht angelegt werden');
    }
  });
  picker.render();
}

// ── Spielstart nach erfolgreichem Login ───────────────────────────────────────
async function startGame(): Promise<void> {
  container.innerHTML = '<div class="loading-screen">Spielstand wird geladen…</div>';

  const result = await apiLoadState();
  if (result.isNewGame) {
    showStartLocationPicker();
    return;
  }
  enterGame(result);
}

// ── Auth-Flow ─────────────────────────────────────────────────────────────────
function showAuth(initialError?: string): void {
  const auth = new LandingUI(container, (token, username) => {
    localStorage.setItem('ft_token', token);
    localStorage.setItem('ft_username', username);
    startGame().catch(console.error);
  }, initialError);
  auth.render();
}

// Klick auf den per Mail verschickten Bestätigungslink (?verifyToken=…) — bestätigt die
// E-Mail und loggt bei Erfolg direkt ein, ohne dass der Nutzer Zugangsdaten erneut eingeben muss.
async function tryVerifyFromUrl(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('verifyToken');
  if (!token) return false;

  window.history.replaceState({}, '', window.location.pathname);
  try {
    const { token: jwt, username } = await apiVerifyEmail(token);
    localStorage.setItem('ft_token', jwt);
    localStorage.setItem('ft_username', username);
    return true;
  } catch (err: any) {
    verifyErrorMessage = err.message ?? 'Bestätigung fehlgeschlagen';
    return false;
  }
}
let verifyErrorMessage: string | undefined;

// ── Einstiegspunkt ────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  const verified = await tryVerifyFromUrl();

  if (verified || isLoggedIn()) {
    startGame().catch(err => {
      console.error('[startGame]', err);
      // Token ungültig/abgelaufen → neu anmelden
      logout();
      showAuth();
    });
  } else {
    showAuth(verifyErrorMessage);
  }
}

bootstrap();
