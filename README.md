# outerbot

Bot Discord d'[Outerpedia](https://outerpedia.com), en production. Deux métiers :

- **Reviews communautaires** : forum `#hero-reviews` (EvaMains), un post par
  perso ; un message `X/5` + texte = une review, réactions 👍/👎 = score. Le
  bot les sert au site via `GET /reviews/:slug` (section Reviews des fiches
  perso).
- **Lookup wiki** : `/char`, `/item`, `/guide` — liens et fiches express dans
  Discord.

Le code du site est dans un repo séparé,
[outerpedia](https://github.com/Sevih/outerpedia) ; l'infrastructure du serveur
qui héberge les deux vit dans un repo d'Infrastructure-as-Code resté privé.

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
- **Contrat HTTP identique à l'ancien bot** (`/reviews`, `/reviews/:slug`,
  `/health`) : le site s'y branche sans adaptation.

⚠️ Le bot tourne sur la **même application Discord** que son prédécesseur : ne
jamais lancer deux process en même temps (un `pnpm dev` local pendant que la
prod tourne), chaque événement serait traité en double.

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
- Les threads hérités de l'ancien bot sont reliés par NOM lors du resync ; les
  irrésolubles sont listés dans le rapport — les relier via `/admin link` ou
  renommer le post.

## Licence

Code sous licence [MIT](./LICENSE). Les données du jeu _Outerplane_ servies par
le bot restent la propriété de leur éditeur (Major9) et de leur développeur
(VA Games). Projet non affilié à l'éditeur.
