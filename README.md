# FieldFaction

Echtzeit-Landwirtschafts-Simulation im Browser: Felder bestellen, Tiere halten,
Rohstoffe verarbeiten und auf einem serverseitigen, geteilten Markt gegen andere
Spieler bieten. Frontend (Vite/TypeScript) und Backend (Express/MySQL) leben in
diesem einen Repo — `src/` fürs Frontend, `server/` fürs Backend.

Der Server ist die alleinige Quelle der Wahrheit für den Spielzustand: der Client
sendet nur Aktions-Absichten (`POST /api/game/action`), nie einen fertigen Zustand.

## Voraussetzungen

- Node.js 20+
- Eine erreichbare MySQL-Datenbank (lokal installiert oder via Docker, siehe unten)

## Lokales Setup

```bash
# Frontend-Abhängigkeiten
npm install

# Backend-Abhängigkeiten
npm --prefix server install
```

Datenbank anlegen und Schema einspielen (passe Verbindungsdaten nach Bedarf an):

```bash
mysql -u root -p -e "CREATE DATABASE farmtycoon"
mysql -u root -p farmtycoon < schema.sql
```

`schema.sql` legt `users` und `game_states` an. Die Markt-Tabellen
(`market_requests`, `market_bids`, `market_credits`, `market_reputation`, …)
erzeugt der Server beim Start selbst (`initTables()` in `server/src/db.ts`).

Server-Umgebungsvariablen konfigurieren:

```bash
cp server/.env.example server/.env
```

| Variable          | Bedeutung                                              |
|-------------------|----------------------------------------------------------|
| `PORT`            | Port des Backends (Standard: 3001)                     |
| `DB_HOST`         | MySQL-Host                                              |
| `DB_PORT`         | MySQL-Port (Standard: 3306)                             |
| `DB_USER`         | MySQL-Benutzer                                          |
| `DB_PASSWORD`     | MySQL-Passwort                                          |
| `DB_NAME`         | Datenbankname (Standard: `farmtycoon`)                  |
| `JWT_SECRET`      | Zufälliger String, min. 64 Zeichen — signiert Login-Tokens |
| `JWT_EXPIRES_IN`  | Gültigkeitsdauer der Tokens (Standard: `7d`)             |
| `FRONTEND_ORIGIN` | Erlaubte CORS-Origin für den Dev-Server (Standard: `http://localhost:5173`) |

## Entwicklung

Zwei Prozesse parallel laufen lassen:

```bash
npm run dev              # Vite-Dev-Server, http://localhost:5173
npm --prefix server run dev   # Backend mit Hot-Reload, http://localhost:3001
```

Der Vite-Dev-Server proxyt `/api/**` automatisch an `localhost:3001` (siehe
`vite.config.ts`) — im Browser reicht `http://localhost:5173`.

## Tests

```bash
npm test              # Frontend-Unit-Tests (Vitest)
npm run test:e2e       # End-to-End-Tests (Playwright, gegen gemocktes Backend — keine DB nötig)
npm --prefix server test   # Backend-Unit-Tests (Vitest, DB gemockt)
npm --prefix server run typecheck   # Backend-Typecheck
```

Alle drei laufen auch automatisch in CI (`.github/workflows/ci.yml`) bei jedem
Push/PR auf `main`.

## Produktions-Build

```bash
npm run build:all      # baut Frontend (dist/) und Backend (server/dist/index.js)
npm start               # startet den Server, der dist/ mit ausliefert
```

Der Server erwartet das gebaute Frontend unter `../dist` relativ zu seiner
eigenen `dist/index.js` — also `<repo-root>/dist`. `npm run build:all` erledigt
die richtige Reihenfolge automatisch.

## Docker

Kompletter Stack (App + MySQL) mit einem Befehl:

```bash
cp server/.env.example server/.env   # JWT_SECRET setzen, DB_* werden von compose überschrieben
docker compose up --build
```

Die App ist danach unter `http://localhost:3001` erreichbar. `schema.sql` wird
beim ersten Start automatisch in die MySQL-Datenbank eingespielt.

## Projektstruktur

```
src/            Frontend (Vite/TypeScript) — UI, Spiellogik (src/farm/Farm.ts), API-Client
server/         Backend (Express/TypeScript) — Routen, Anti-Cheat/Simulation, Markt-Matching
  src/game/     Server-seitige Nutzung der geteilten Farm.ts-Logik (Issue #7)
e2e/            Playwright End-to-End-Tests
schema.sql      MySQL-Basisschema (users, game_states)
```
