import type { Page } from '@playwright/test';
import {
  createInitialState, emptyTickEvents,
  unlockFarm, openNewFarm, buyPlot, tillPlot, plantCrop, harvestPlot,
  buildStall, buildSecondHalfStall, collectStall, buyAnimal, sellFromStorage,
  buildProcessingBuilding, loadProcessing, collectProcessingOutput,
  setSlaughterTarget, setSlaughterAnimal,
  buyVehicle, moveVehicle, buyImplement, moveImplement,
  designateField, demolishPlot, sellToMerchant,
  startDelivery, hireEmployee, moveEmployee, fireEmployee,
} from '../src/farm/Farm';
import type { GameState } from '../src/types';

const FARM_ID = 'muenchen';

// Mirrors server/src/game/actions.ts's allowlist — same production functions, so the
// mocked backend below behaves exactly like the real one without needing a live server/DB.
const GAME_ACTIONS: Record<string, (...args: any[]) => GameState> = {
  unlockFarm, openNewFarm, buyPlot, designateField, tillPlot, plantCrop, harvestPlot,
  demolishPlot, buildStall, buildSecondHalfStall, collectStall, buyAnimal,
  buildProcessingBuilding, loadProcessing, collectProcessingOutput,
  setSlaughterAnimal, setSlaughterTarget, sellToMerchant, sellFromStorage,
  startDelivery, buyVehicle, moveVehicle, buyImplement, moveImplement,
  hireEmployee, moveEmployee, fireEmployee,
};

// These e2e tests never talk to a real backend — every `/api/**` call is
// intercepted at the browser network layer, so no server/DB needs to run.
// Fixtures build real GameState objects via the production Farm.ts code so
// the shape can't drift from what the app actually produces.

export function freshGameState(storageOverrides: Record<string, number> = {}): GameState {
  const state = createInitialState();
  const farm = state.farms[FARM_ID];
  return {
    ...state,
    farms: {
      ...state.farms,
      [FARM_ID]: { ...farm, storage: { ...farm.storage, ...storageOverrides } },
    },
  };
}

// Deterministisch aus dem Usernamen abgeleiteter "Token" — genug, um den kompletten
// Registrieren-→-Verifizieren-Flow durchzuspielen, ohne echten Mail-Versand.
function fakeVerificationToken(username: string): string {
  return `verify-token-for-${username}`;
}

export async function mockAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/login', async route => {
    const body = route.request().postDataJSON();
    if (body?.login === 'testuser' && body?.password === 'correct-password') {
      await route.fulfill({ json: { token: 'fake-jwt-token', username: 'testuser' } });
    } else if (body?.login === 'unverified' && body?.password === 'correct-password') {
      await route.fulfill({ status: 403, json: { error: 'E-Mail noch nicht bestätigt', code: 'email_not_verified' } });
    } else {
      await route.fulfill({ status: 401, json: { error: 'Benutzername oder Passwort falsch' } });
    }
  });

  await page.route('**/api/auth/register', async route => {
    const body = route.request().postDataJSON();
    if (body?.username === 'taken') {
      await route.fulfill({ status: 409, json: { error: 'Benutzername bereits vergeben' } });
    } else {
      await route.fulfill({ status: 201, json: { requiresVerification: true, email: body?.email } });
    }
  });

  await page.route('**/api/auth/verify', async route => {
    const { token } = route.request().postDataJSON() ?? {};
    if (typeof token === 'string' && token.startsWith('verify-token-for-')) {
      const username = token.slice('verify-token-for-'.length);
      await route.fulfill({ json: { token: 'fake-jwt-token', username } });
    } else {
      await route.fulfill({ status: 400, json: { error: 'Ungültiger Bestätigungslink' } });
    }
  });

  await page.route('**/api/auth/resend-verification', async route => {
    await route.fulfill({ json: { ok: true } });
  });
}

// Simuliert den Klick auf den per Mail verschickten Bestätigungslink.
export function verificationLinkFor(username: string): string {
  return `/?verifyToken=${fakeVerificationToken(username)}`;
}

// Nominatim-Stadtsuche (StartLocationUI, "Standort eröffnen") — echter externer Aufruf,
// wird für Tests auf ein festes Ergebnis gemockt.
export async function mockCitySearch(page: Page, city: string, lat: number, lon: number): Promise<void> {
  await page.route('https://nominatim.openstreetmap.org/**', async route => {
    await route.fulfill({
      json: [{
        lat: String(lat), lon: String(lon),
        address: { city, country_code: 'de', state: 'Test-Bundesland' },
      }],
    });
  });
}

// Stateful fake backend for GET /game/state, POST /game/start und POST /game/action:
// hält einen veränderlichen GameState im Closure und wendet dieselben Reducer-
// Funktionen an wie der echte Server (siehe server/src/game/actions.ts), damit Tests
// echte Spiellogik statt einer Handnachbildung durchlaufen. Ohne `initialState` (bzw.
// mit `null`) verhält es sich wie ein frisch verifizierter Account ohne Spielstand —
// erst POST /game/start legt einen an (genau wie beim echten Server).
export async function mockGameServer(page: Page, initialState: GameState | null = null): Promise<void> {
  let state: GameState | null = initialState;

  await page.route('**/api/game/state', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!state) {
      await route.fulfill({ json: { newGame: true } });
      return;
    }
    await route.fulfill({
      json: {
        newGame: false,
        state,
        events: emptyTickEvents(),
        offlineSeconds: 0,
        previousMarketPrices: state.marketPrices,
      },
    });
  });

  await page.route('**/api/game/start', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!state) {
      const { city, farmName, lat, lon } = route.request().postDataJSON() ?? {};
      const id = `${String(city).toLowerCase()}_test`;
      state = createInitialState({ id, name: farmName || `Gut ${city}`, city, lat, lon });
    }
    await route.fulfill({
      json: {
        newGame: false, state,
        events: emptyTickEvents(), offlineSeconds: 0, previousMarketPrices: state.marketPrices,
      },
    });
  });

  await page.route('**/api/game/action', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!state) {
      await route.fulfill({ status: 409, json: { error: 'Noch kein Spielstand' } });
      return;
    }
    const { type, args } = route.request().postDataJSON() ?? {};
    const action = GAME_ACTIONS[type];
    if (!action) {
      await route.fulfill({ status: 400, json: { error: `Unbekannte Aktion: ${type}` } });
      return;
    }
    state = action(state, ...(Array.isArray(args) ? args : []));
    await route.fulfill({ json: { state, events: emptyTickEvents(), notifications: [] } });
  });
}

export async function mockMarket(page: Page, opts: {
  requests?: any[];
  bids?: any[];
  reputation?: Record<string, number>;
  onBidSubmit?: (body: any) => void;
} = {}): Promise<void> {
  await page.route('**/api/market/requests*', route =>
    route.fulfill({ json: { requests: opts.requests ?? [] } }));
  await page.route('**/api/market/bids', route =>
    route.fulfill({ json: { bids: opts.bids ?? [] } }));
  await page.route('**/api/market/reputation', route =>
    route.fulfill({ json: { reputation: opts.reputation ?? {} } }));
  await page.route('**/api/market/credits', route =>
    route.fulfill({ json: { credits: [] } }));
  await page.route('**/api/market/bid', async route => {
    if (route.request().method() === 'POST') {
      opts.onBidSubmit?.(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: 999 } });
    } else {
      await route.continue();
    }
  });
}

export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#f-login', 'testuser');
  await page.fill('#f-password', 'correct-password');
  await page.click('.auth-submit');
  await page.locator('.field-card').first().waitFor();
}
