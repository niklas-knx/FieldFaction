import { createInitialState, tickGame } from './farm/Farm';
import { FarmUI } from './ui/FarmUI';
import { LandingUI } from './ui/LandingUI';
import type { GameState } from './types';
import { apiLoadState, apiSaveState, isLoggedIn, logout, apiGetMarketCredits, apiMarkCreditsApplied, applyMarketCredits } from './api';
import './style.css';
import 'leaflet/dist/leaflet.css';

const SAVE_VERSION = 7;
const AUTOSAVE_INTERVAL_MS = 30_000; // alle 30s zum Server speichern

const container = document.getElementById('app')!;

let state: GameState;
let ui: FarmUI;

// ── Update-Funktion (wird von UI bei Aktionen aufgerufen) ─────────────────────
const update = (newState: GameState) => {
  state = newState;
  ui.render(state);
};

// ── Spielstart nach erfolgreichem Login ───────────────────────────────────────
async function startGame(): Promise<void> {
  container.innerHTML = '<div class="loading-screen">Spielstand wird geladen…</div>';

  const result = await apiLoadState();

  if (result.newGame) {
    state = createInitialState();
  } else {
    state = result.state;
    // Offline-Fortschritt nachholen (max. 7 Tage, in Server begrenzt)
    if (result.offlineTicks > 0) {
      console.info(`[FarmTycoon] ${result.offlineTicks} Offline-Ticks werden nachgeholt…`);
      for (let i = 0; i < result.offlineTicks; i++) {
        state = tickGame(state);
      }
    }
  }

  ui = new FarmUI(container, update);
  ui.bindKeyboard(() => state, update);

  // Tick-Loop (1 Tick/Sekunde)
  setInterval(() => {
    state = tickGame(state);
    ui.render(state);
  }, 1000);

  // Autosave + Markt-Credits alle 30 Sekunden
  setInterval(async () => {
    try {
      const { credits } = await apiGetMarketCredits();
      if (credits.length > 0) {
        state = applyMarketCredits(state, credits);
        ui.render(state);
        await apiMarkCreditsApplied(credits.map(c => c.id));
      }
    } catch { /* Credits fehlgeschlagen — nächster Versuch in 30s */ }
    apiSaveState(state).catch(err => console.warn('[Autosave]', err));
  }, AUTOSAVE_INTERVAL_MS);

  // Speichern beim Schließen des Tabs
  window.addEventListener('beforeunload', () => {
    apiSaveState(state);
  });

  ui.render(state);
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
