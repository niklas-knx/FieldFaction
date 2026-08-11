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

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error('Server nicht erreichbar – läuft der Backend-Server?');
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Ungültige Server-Antwort (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function apiRegister(username: string, email: string, password: string): Promise<{ token: string; username: string }> {
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

// ── Game State ────────────────────────────────────────────────────────────────
// Seit Issue #7 ist der Server die alleinige Quelle der Wahrheit für den Spielzustand:
// der Client liest ihn nur noch (apiLoadState) und schickt Absichten (apiDispatchAction),
// nie mehr einen fertigen State-Blob. Ein PUT, das den Client-State ungeprüft übernimmt,
// gibt es bewusst nicht mehr.

// Der Server legt bei Bedarf selbst einen neuen Spielstand an (createInitialState()
// läuft nur noch serverseitig) — `state` ist daher immer vorhanden, `isNewGame` dient
// nur noch der "Willkommen"-Anzeige, nicht mehr der Entscheidung, ob der Client selbst
// einen State erzeugen muss.
export interface LoadResult {
  state: GameState;
  events: TickEvents;
  offlineSeconds: number;
  isNewGame: boolean;
  previousMarketPrices: Record<string, number>;
}

export async function apiLoadState(): Promise<LoadResult> {
  const res = await fetch(`${BASE}/game/state`, { headers: authHeaders() });
  const data = await handleResponse<any>(res);
  return {
    state: data.state,
    events: data.events,
    offlineSeconds: data.offlineSeconds,
    isNewGame: data.newGame,
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

// ── Market: Info (Wettbewerb) ─────────────────────────────────────────────────

export async function apiGetMarketInfo(city: string, merchantId: string): Promise<{ competition: Record<string, number> }> {
  const res = await fetch(`${BASE}/market/info/${city}/${merchantId}`, { headers: authHeaders() });
  return handleResponse(res);
}
