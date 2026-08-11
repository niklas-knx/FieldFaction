# ── Build ────────────────────────────────────────────────────────────────────
# One combined build stage: the server bundle (esbuild) inlines the shared
# game-logic modules straight from ../src (see server/src/game/*.ts and
# server/tsconfig.json), so the server build needs the real frontend source
# present too — not just its own directory.
FROM node:20-slim AS build
WORKDIR /app

# bcrypt has a native binding; these let npm compile it if no prebuilt binary
# matches the target platform/Node ABI.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci

COPY . .
RUN npm run build:all

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Fresh production-only install — keeps devDependencies (tsx, esbuild, vitest, …)
# out of the final image.
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev \
    && apt-get purge -y --auto-remove python3 make g++

COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
