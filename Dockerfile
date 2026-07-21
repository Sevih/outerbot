# syntax=docker/dockerfile:1
###############################################################################
# Image de production outerbot (bot Discord + API reviews).
#
# Multi-stage : deps complètes → build tsc → deps de PROD seules → runner
# minimal non-root. better-sqlite3 est un module NATIF : son binaire vient des
# prebuilds officiels au `pnpm install` (autorisé via allowBuilds dans
# pnpm-workspace.yaml) — aucune toolchain C++ dans l'image.
###############################################################################

# ---- Base (avec pnpm) ----
FROM node:24-bookworm-slim AS base
WORKDIR /app
# DOIT rester aligné sur "packageManager" de package.json (même règle que le
# site : le pin est répété car pnpm s'installe avant le COPY des manifestes,
# pour garder le cache Docker de cette couche).
RUN npm install -g pnpm@11.13.0

# ---- Étape 1 : dépendances complètes (build + tests) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Étape 2 : build TypeScript ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
# Lockfile + workspace.yaml inclus : pnpm vérifie l'état des deps avant tout
# script (`pnpm build` → re-install) et sans le `allowBuilds` du workspace ce
# re-install échoue en ERR_PNPM_IGNORED_BUILDS (constaté au premier build CI).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---- Étape 3 : dépendances de PROD seules (discord.js + better-sqlite3) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- Étape 4 : runner ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# La base vit dans un VOLUME (déclaré côté stack) : elle survit aux redéploiements.
ENV DB_PATH=/data/outerbot.sqlite

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs outerbot \
 && mkdir -p /data && chown outerbot:nodejs /data

COPY --from=prod-deps --chown=outerbot:nodejs /app/node_modules ./node_modules
COPY --from=builder   --chown=outerbot:nodejs /app/dist ./dist
COPY --chown=outerbot:nodejs package.json ./

USER outerbot
EXPOSE 3001
# /health répond même si Discord est down (l'API reviews sert du SQLite local) —
# c'est bien l'état du PROCESS qu'on sonde, pas celui de Discord.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.HTTP_PORT ?? 3001}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/index.js"]
