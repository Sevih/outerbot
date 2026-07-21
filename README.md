# outerbot

Bot Discord d'[Outerpedia](https://outerpedia.com) — refonte propre du bot V2
(`outerpedia-bot`). Deux métiers :

- **Reviews communautaires** : forum `#hero-reviews` (EvaMains), un post par
  perso ; un message `X/5` + texte = une review, réactions 👍/👎 = score. Le
  bot les sert au site via `GET /reviews/:slug` (section Reviews des fiches
  perso).
- **Lookup wiki** : `/char`, `/item`, `/guide` — liens et fiches express dans
  Discord.

## Principes (design acté 2026-07-21)

- **Discord est la source de vérité** du contenu ; SQLite (`data/outerbot.sqlite`)
  n'est qu'un **index reconstructible** — `/admin resync` rescanne tout
  (threads actifs + archivés, TOUS les messages, scores recalculés).
- **Le slug d'un perso est posé par le bot** à la création du post forum
  (slug canonique du site), jamais déduit du nom du thread.
- **Aucune donnée wiki dans le repo** : le bot interroge l'API interne du site
  (`WIKI_API_URL/api/bot/*`), cache mémoire TTL 1 h, repli stale si le site est
  injoignable.
- **Zéro procédure par perso** : cron interne (6 h) + `/admin sync` créent les
  posts forum manquants tout seuls. Les liens de build curés s'éditent par
  `/admin link` (plus de JSON committé).
- **Contrat HTTP identique au bot V2** (`/reviews`, `/reviews/:slug`,
  `/health`) : le site s'y branche sans adaptation.

## Dev

```bash
cp .env.example .env      # remplir DISCORD_TOKEN, CLIENT_ID, REVIEW_FORUM_ID
pnpm install
pnpm deploy-commands      # enregistre les slash commands (scope guild)
pnpm dev                  # tsx watch
pnpm test                 # cœur pur + store (base mémoire)
```

## Exploitation

- Premier démarrage (ou base perdue) : resync automatique depuis Discord.
- `/status` : état complet (reviews, données wiki, persos sans thread).
- `/health` (HTTP) : healthcheck Docker.
- Les threads hérités du bot V2 sont reliés par NOM lors du resync ; les
  irrésolubles sont listés dans le rapport — les relier via `/admin link` ou
  renommer le post.
