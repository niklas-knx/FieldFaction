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
mysql -u root -p -e "CREATE DATABASE fieldfaction"
mysql -u root -p fieldfaction < schema.sql
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
| `DB_NAME`         | Datenbankname (Standard: `fieldfaction`)                  |
| `JWT_SECRET`      | Zufälliger String, min. 64 Zeichen — signiert Login-Tokens |
| `JWT_EXPIRES_IN`  | Gültigkeitsdauer der Tokens (Standard: `7d`)             |
| `FRONTEND_ORIGIN` | Erlaubte CORS-Origin, gleichzeitig Basis für Verifizierungs-Links (Standard: `http://localhost:5173`) |
| `SMTP_HOST`       | SMTP-Server für Verifizierungs-Mails — **leer lassen** für lokale Entwicklung: Bestätigungslinks werden dann nur in die Server-Konsole geloggt |
| `SMTP_PORT`       | SMTP-Port (Standard: 587)                                |
| `SMTP_USER`/`SMTP_PASS` | SMTP-Zugangsdaten (falls der Provider Auth verlangt)|
| `SMTP_FROM`       | Absenderadresse der Verifizierungs-Mails                 |

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

Kompletter Stack (App + MySQL) mit einem Befehl — praktisch für lokale Entwicklung
oder Server, auf denen Docker läuft:

```bash
cp server/.env.example server/.env   # JWT_SECRET setzen, DB_* werden von compose überschrieben
docker compose up --build
```

Die App ist danach unter `http://localhost:3001` erreichbar. `schema.sql` wird
beim ersten Start automatisch in die MySQL-Datenbank eingespielt.

## Deployment auf Windows Server / IIS (ohne Docker)

Für einen Windows-Server, auf dem bereits andere Seiten über IIS laufen und eine
eigene MySQL-Instanz existiert (z.B. per MySQL Workbench verwaltet) — Node läuft dabei
als eigenständiger Hintergrundprozess, IIS reicht Anfragen nur per Reverse Proxy durch.
**Hinweis:** Diese Anleitung ist mangels Windows-/IIS-Testumgebung nicht selbst
durchgespielt worden — vor dem produktiven Einsatz einmal end-to-end gegenprüfen.

**Voraussetzungen auf dem Server:**
- Node.js 20+
- IIS mit den Modulen [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite) und
  [Application Request Routing (ARR)](https://www.iis.net/downloads/microsoft/application-request-routing)
  (serverweit installiert — ARR läuft eventuell schon für SimSpedition mit)
- Ein Prozess-Manager, der den Node-Prozess dauerhaft am Laufen hält (siehe Schritt 4) —
  ohne einen läuft jeder Deploy sonst auf "PID suchen, killen, `node dist\index.js`
  manuell neu in einem Fenster starten" raus, das nervt auf Dauer und vergisst man leicht

**1. Datenbank in der bestehenden MySQL-Instanz anlegen** (z.B. in Workbench):
```sql
CREATE DATABASE fieldfaction;
```
Dann `schema.sql` gegen diese Datenbank ausführen (Workbench: *File → Run SQL Script*).

**2. Repo bauen** (auf dem Server oder lokal bauen und `dist/`, `server/dist/`,
`server/node_modules/` mit hochladen — `node_modules` sollte aber wegen `bcrypt`s
nativer Bindings direkt auf dem Zielserver installiert werden):
```powershell
npm install
npm --prefix server install
npm run build:all
```

**3. `server\.env` konfigurieren** — `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` zeigen
auf die bestehende MySQL-Instanz (z.B. `DB_HOST=localhost`, falls MySQL auf demselben
Server läuft), `DB_NAME=fieldfaction`, `JWT_SECRET` setzen, `FRONTEND_ORIGIN` auf die
später genutzte Domain/URL:
```powershell
copy server\.env.example server\.env
notepad server\.env
```

**4. Node dauerhaft am Laufen halten — mit PM2 (empfohlen):**

PM2 kommt per npm, kein separater Download nötig. Läuft der Server aktuell noch als
nackter `node.exe`-Prozess (z.B. über `start "FieldFaction" node dist\index.js`
gestartet), den einmalig beenden (`netstat -ano | findstr :3001` → PID → `taskkill /PID
<PID> /F`), bevor PM2 übernimmt:
```powershell
npm install -g pm2
cd C:\pfad\zu\fieldfaction\server
pm2 start dist\index.js --name fieldfaction
```
Kurzer Check, bevor IIS eingebunden wird: `curl http://localhost:3001/api/health`
sollte `{"ok":true}` liefern.

Optional, damit PM2 auch einen kompletten Server-Neustart übersteht (sonst muss nach
einem Reboot einmal `pm2 resurrect` von Hand laufen):
```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

<details>
<summary>Alternative: NSSM (Windows-Dienst)</summary>

Braucht einen separaten Download ([nssm.cc](https://nssm.cc/)), übersteht einen
Server-Neustart dafür ohne Zusatzpaket:
```powershell
nssm install FieldFaction "C:\Program Files\nodejs\node.exe" "dist\index.js"
nssm set FieldFaction AppDirectory "C:\pfad\zu\fieldfaction\server"
nssm start FieldFaction
```
Neustart nach einem Update dann `nssm restart FieldFaction` statt `pm2 restart
fieldfaction` (siehe unten).
</details>

**5. IIS als Reverse Proxy einrichten:**
- Im IIS-Manager am Server-Knoten unter *Application Request Routing Cache →
  Server Proxy Settings* einmalig **Enable proxy** aktivieren.
- Neue Website (eigene Bindung/Hostname, **nicht** die von SimSpedition) anlegen, z.B.
  `fieldfaction.deine-domain.de`.
- [`deploy/iis-web.config`](deploy/iis-web.config) in den physischen Pfad dieser
  Website legen (Port darin anpassen, falls `PORT` in `server/.env` nicht 3001 ist).

**Neustart/Update** — ab jetzt ein einziger Befehl statt PID suchen/killen:
```powershell
cd C:\pfad\zu\fieldfaction
git pull
npm run build:all
pm2 restart fieldfaction
```
Oder alles in einem Rutsch über [`deploy/redeploy.ps1`](deploy/redeploy.ps1).

## Projektstruktur

```
src/            Frontend (Vite/TypeScript) — UI, Spiellogik (src/farm/Farm.ts), API-Client
server/         Backend (Express/TypeScript) — Routen, Anti-Cheat/Simulation, Markt-Matching
  src/game/     Server-seitige Nutzung der geteilten Farm.ts-Logik (Issue #7)
e2e/            Playwright End-to-End-Tests
schema.sql      MySQL-Basisschema (users, game_states)
```
