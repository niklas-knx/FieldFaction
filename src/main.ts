import { FarmUI } from './ui/FarmUI';
import type { WelcomeBackSummary } from './ui/FarmUI';
import { LandingUI } from './ui/LandingUI';
import type { GameState } from './types';
import type { TickEvents } from './farm/Farm';
import { PRODUCTS, formatAmount } from './data/products';
import { EMPLOYEE_ROLES } from './data/employees';
import { bus } from './core/EventBus';
import { apiLoadState, isLoggedIn, logout } from './api';
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

// ── Spielstart nach erfolgreichem Login ───────────────────────────────────────
async function startGame(): Promise<void> {
  container.innerHTML = '<div class="loading-screen">Spielstand wird geladen…</div>';

  const result = await apiLoadState();
  state = result.state;

  let welcomeBack: WelcomeBackSummary | null = null;
  if (!result.isNewGame && result.offlineSeconds > 0) {
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
  setInterval(() => ui.render(state), RENDER_INTERVAL_MS);

  // Periodischer Sync: holt den serverseitig fortgeschriebenen Stand (Feldwachstum,
  // Tierproduktion, Lieferungen, Löhne, gewonnene Markt-Gebote, …) — Dinge, die ohne
  // eigenes Zutun im Hintergrund passieren.
  setInterval(async () => {
    try {
      const r = await apiLoadState();
      state = r.state;
      notifyLiveTickEvents(r.events);
      ui.render(state);
    } catch (err) {
      console.warn('[Sync]', err);
    }
  }, SYNC_INTERVAL_MS);
}

// ── Auth-Flow ─────────────────────────────────────────────────────────────────
function showAuth(): void {
  const auth = new LandingUI(container, (token, username) => {
    localStorage.setItem('ft_token', token);
    localStorage.setItem('ft_username', username);
    startGame().catch(console.error);
  });
  auth.render();
}

// ── Einstiegspunkt ────────────────────────────────────────────────────────────
if (isLoggedIn()) {
  startGame().catch(err => {
    console.error('[startGame]', err);
    // Token ungültig/abgelaufen → neu anmelden
    logout();
    showAuth();
  });
} else {
  showAuth();
}
