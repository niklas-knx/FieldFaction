import type { GameState, MarketRequest, MarketBid } from './types';
import type { TickEvents } from './farm/Farm';

const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('ft_token');
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// Server-Fehler tragen manchmal einen `code` (z.B. 'email_not_verified'), damit der
// Aufrufer gezielt reagieren kann statt nur die Fehlermeldung anzuzeigen.
export interface ApiError extends Error { code?: string }

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error('Server nicht erreichbar – läuft der Backend-Server?');
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Ungültige Server-Antwort (HTTP ${res.status})`); }
  if (!res.ok) {
    const err: ApiError = new Error(data.error ?? `HTTP ${res.status}`);
    if (data.code) err.code = data.code;
    throw err;
  }
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// Registrierung gibt kein Token mehr zurück — der Account ist erst nach Klick auf den
// per Mail verschickten Bestätigungslink nutzbar (apiVerifyEmail). apiLogin wirft bei
// unbestätigten Accounts einen Fehler mit code === 'email_not_verified'.

export async function apiRegister(username: string, email: string, password: string): Promise<{ requiresVerification: true; email: string }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  return handleResponse(res);
}

export async function apiLogin(login: string, password: string): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  return handleResponse(res);
}

export async function apiVerifyEmail(token: string): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return handleResponse(res);
}

export async function apiResendVerification(login: string): Promise<void> {
  await fetch(`${BASE}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  });
}

// ── Game State ────────────────────────────────────────────────────────────────
// Seit Issue #7 ist der Server die alleinige Quelle der Wahrheit für den Spielzustand:
// der Client liest ihn nur noch (apiLoadState) und schickt Absichten (apiDispatchAction),
// nie mehr einen fertigen State-Blob. Ein PUT, das den Client-State ungeprüft übernimmt,
// gibt es bewusst nicht mehr.

// Ein frisch verifizierter Account hat noch keinen Spielstand, bis er per apiStartGame
// einen Startort gewählt hat — `state` fehlt dann (isNewGame: true).
export type LoadResult =
  | { isNewGame: true }
  | {
      isNewGame: false;
      state: GameState;
      events: TickEvents;
      offlineSeconds: number;
      previousMarketPrices: Record<string, number>;
    };

export async function apiLoadState(): Promise<LoadResult> {
  const res = await fetch(`${BASE}/game/state`, { headers: authHeaders() });
  const data = await handleResponse<any>(res);
  if (data.newGame) return { isNewGame: true };
  return {
    isNewGame: false,
    state: data.state,
    events: data.events,
    offlineSeconds: data.offlineSeconds,
    previousMarketPrices: data.previousMarketPrices ?? data.state.marketPrices,
  };
}

// Legt (einmalig) den Spielstand mit dem gewählten Startort an — idempotent, ein
// zweiter Aufruf liefert einfach den bereits vorhandenen (fortgeschriebenen) Stand.
export async function apiStartGame(
  city: string, farmName: string, lat: number, lon: number,
): Promise<Exclude<LoadResult, { isNewGame: true }>> {
  const res = await fetch(`${BASE}/game/start`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ city, farmName, lat, lon }),
  });
  const data = await handleResponse<any>(res);
  return {
    isNewGame: false,
    state: data.state,
    events: data.events,
    offlineSeconds: data.offlineSeconds,
    previousMarketPrices: data.previousMarketPrices ?? data.state.marketPrices,
  };
}

export interface DispatchResult {
  state: GameState;
  events: TickEvents;
  notifications: string[];
}

// Führt eine einzelne Spielaktion serverseitig aus (z.B. 'tillPlot' mit [farmId, plotId])
// — args müssen exakt der Parameterreihenfolge der jeweiligen Funktion in
// src/farm/Farm.ts entsprechen (siehe server/src/game/actions.ts für die Allowlist).
export async function apiDispatchAction(type: string, args: unknown[]): Promise<DispatchResult> {
  const res = await fetch(`${BASE}/game/action`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ type, args }),
  });
  return handleResponse(res);
}

export async function apiResetState(): Promise<void> {
  await fetch(`${BASE}/game/state`, { method: 'DELETE', headers: authHeaders() });
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout(): void {
  localStorage.removeItem('ft_token');
  localStorage.removeItem('ft_username');
}

// ── Market: Anfragen ─────────────────────────────────────────────────────────

export async function apiGetMarketRequests(cities: string[]): Promise<{ requests: MarketRequest[] }> {
  const q = cities.length > 0 ? `?cities=${cities.join(',')}` : '';
  const res = await fetch(`${BASE}/market/requests${q}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiSubmitBid(
  requestId: number,
  farmId: string,
  pricePerUnit: number,
  quantityOffered: number,
): Promise<{ id: number }> {
  const res = await fetch(`${BASE}/market/bid`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ requestId, farmId, pricePerUnit, quantityOffered }),
  });
  return handleResponse(res);
}

export async function apiGetMyBids(): Promise<{ bids: MarketBid[] }> {
  const res = await fetch(`${BASE}/market/bids`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiCancelBid(bidId: number): Promise<void> {
  await fetch(`${BASE}/market/bid/${bidId}`, { method: 'DELETE', headers: authHeaders() });
}

// ── Market: Reputation ────────────────────────────────────────────────────────

export async function apiGetReputation(): Promise<{ reputation: Record<string, number> }> {
  const res = await fetch(`${BASE}/market/reputation`, { headers: authHeaders() });
  return handleResponse(res);
}
