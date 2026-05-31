import type { GameState, MarketRequest, MarketBid, MarketCredit, ProductChange } from './types';

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

export type LoadResult =
  | { newGame: true }
  | { newGame: false; state: GameState; offlineTicks: number };

export async function apiLoadState(): Promise<LoadResult> {
  const res = await fetch(`${BASE}/game/state`, { headers: authHeaders() });
  const data = await handleResponse<any>(res);
  if (data.newGame) return { newGame: true };
  return { newGame: false, state: data.state, offlineTicks: data.offlineTicks };
}

export async function apiSaveState(state: GameState): Promise<void> {
  await fetch(`${BASE}/game/state`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ state }),
  });
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

// ── Market: Credits ───────────────────────────────────────────────────────────

export async function apiGetMarketCredits(): Promise<{ credits: MarketCredit[] }> {
  const res = await fetch(`${BASE}/market/credits`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function apiMarkCreditsApplied(ids: number[]): Promise<void> {
  await fetch(`${BASE}/market/credits/apply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
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

// ── Helper: Credits auf GameState anwenden ────────────────────────────────────

export function applyMarketCredits(state: GameState, credits: MarketCredit[]): GameState {
  let s = state;
  for (const credit of credits) {
    s = { ...s, money: s.money + credit.amountEur };
    for (const change of credit.productChanges) {
      const farm = s.farms[change.farmId];
      if (!farm) continue;
      const current = farm.storage[change.productId] ?? 0;
      const newAmt   = Math.max(0, current + change.amount);
      s = {
        ...s,
        farms: {
          ...s.farms,
          [change.farmId]: {
            ...farm,
            storage: { ...farm.storage, [change.productId]: newAmt },
          },
        },
      };
    }
  }
  return s;
}
