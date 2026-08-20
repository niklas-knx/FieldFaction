import { FarmUI } from './ui/FarmUI';
import type { WelcomeBackSummary } from './ui/FarmUI';
import { LandingUI } from './ui/LandingUI';
import { StartLocationUI } from './ui/StartLocationUI';
import type { GameState } from './types';
import type { TickEvents } from './farm/Farm';
import { apiLoadState, apiStartGame, apiVerifyEmail, isLoggedIn, logout, type LoadResult, type EarningsSummary } from './api';
import './style.css';
import 'leaflet/dist/leaflet.css';

// Seit Issue #7 ist der Server die alleinige Quelle der Wahrheit für den Spielzustand —
// der Client erzeugt keine Ticks mehr selbst (kein lokaler tickGame()-Loop, kein
// Autosave-PUT) und fragt auch nicht mehr periodisch von sich aus nach — frischer Stand
// kommt ausschließlich als Antwort auf eigene Aktionen zurück (siehe FarmUI.dispatch()).
const RENDER_INTERVAL_MS = 1_000; // rein kosmetischer Re-render-Takt für Fortschrittsbalken
// Erst ab dieser Abwesenheit lohnt sich das "Willkommen zurück"-Popup — sonst würde es
// auch bei jedem kurzen Neuladen der Seite aufpoppen.
const WELCOME_BACK_MIN_SECONDS = 5 * 60;

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
  earnings: EarningsSummary,
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
    earnings,
    fieldsHarvested: events.fieldsHarvested,
    stallCollectionsReady: events.stallCollectionsReady,
    processingCompleted: events.processingCompleted,
    deliveriesArrived: events.deliveriesArrived,
    employeesFired: events.employeesFired,
    wagesPaid: events.wagesPaid,
    interestAccrued: events.interestAccrued,
    topPriceMoves,
  };
}

// ── Spiel mit einem bereits geladenen Stand betreten (normaler Login ODER direkt
// nach Wahl des Startorts) ─────────────────────────────────────────────────────
function enterGame(result: LoadedResult): void {
  state = result.state;

  let welcomeBack: WelcomeBackSummary | null = null;
  if (result.offlineSeconds >= WELCOME_BACK_MIN_SECONDS) {
    welcomeBack = buildWelcomeBackSummary(
      result.offlineSeconds, result.previousMarketPrices, state.marketPrices, result.events, result.earnings,
    );
  }

  ui = new FarmUI(container, update);
  ui.bindKeyboard(() => state, update);
  ui.render(state);
  if (welcomeBack) ui.showWelcomeBack(welcomeBack);

  // Rein kosmetischer Re-render-Takt: aktualisiert Fortschrittsbalken/Restzeiten im
  // Sekundentakt, ohne selbst neuen Spielzustand zu erzeugen.
  setInterval(() => ui.render(state, true), RENDER_INTERVAL_MS);
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
