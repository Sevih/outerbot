# outerbot

Bot Discord d'[Outerpedia](https://outerpedia.com), en production. Deux métiers :

- **Reviews communautaires** : forum `#hero-reviews` (EvaMains), un post par
  perso ; un message `X/5` + texte = une review, réactions 👍/👎 = score. Le
  bot les sert au site via `GET /reviews/:id` (id du perso, ou son slug ;
  section Reviews des fiches perso).
- **Lookup wiki** : `/char`, `/item`, `/guide` — liens et fiches express dans
  Discord.
- **Annonces** : chaque nouveau code promo et chaque nouvelle entrée du journal
  du site (`/changelog`) est posté dans `ANNOUNCE_CHANNEL_ID`.
- **Codes promo par le staff** : `/coupon add|edit|remove`, réservé aux rôles
  `STAFF_ROLE_IDS`. Récompenses, codes existants et dates en autocomplétion, aperçu
  de l'annonce puis confirmation.

Le code du site est dans un repo séparé,
[outerpedia](https://github.com/Sevih/outerpedia) ; l'infrastructure du serveur
qui héberge les deux vit dans un repo d'Infrastructure-as-Code resté privé.

## Principes (design acté 2026-07-21)

- **Discord est la source de vérité** du contenu ; SQLite (`data/outerbot.sqlite`)
  n'est qu'un **index reconstructible** — `/admin resync` rescanne tout
  (threads actifs + archivés, TOUS les messages, scores recalculés).
- **Un perso est désigné par son id** (`id` de `/api/bot/characters`, stable),
  posé par le bot à la création du post forum, jamais déduit du nom du thread.
  Posts, reviews et liens de build sont indexés par id ; le slug, dérivé du nom
  affiché et recalculé par le site, ne sert qu'à l'affichage et au repli : un
  perso renommé garde ses reviews, son post et son lien. Les lignes d'avant
  l'id se remplissent d'après leur slug en tête de chaque forum-sync et resync ;
  `/status` montre les slugs restés sans id.
- **Aucune donnée wiki dans le repo** : le bot interroge l'API interne du site
  (`WIKI_API_URL/api/bot/*`), cache mémoire TTL 1 h, repli stale si le site est
  injoignable. Il ne construit **aucun lien du site** (deux exceptions, les
  index `/characters` et `/guides` de `/char` et `/guide`, nus comme les `href`
  du contrat) : fiches, guides, équipements, page des codes, vignettes, URL
  d'échange et id des entrées du journal arrivent dans le contrat, le bot ne
  fait que préfixer ses bases (`SITE_BASE_URL`, `IMG_BASE_URL`). Des extraits
  réels de chaque route vivent dans `test/fixtures/bot-api/`, recopiés du site
  (`test/contract.test.ts`).
- **Zéro procédure par perso** : cron interne (6 h) + `/admin sync` créent les
  posts forum manquants tout seuls. Les liens de build curés s'éditent par
  `/admin link` (plus de JSON committé).
- **Les annonces suivent ce que le site affiche** : le bot interroge
  `/api/bot/coupons` et `/api/bot/changelog` (sans cache) chaque minute. Un coupon part
  à sa date de début, une entrée du journal une fois déployée et à sa date. Au
  premier passage (base neuve ou perdue), l'existant est marqué vu sans être
  posté.
- **Le bot n'écrit aucun coupon lui-même** : `/coupon` envoie l'opération à la
  route interne du site (`/api/internal/coupons`, jeton `COUPON_API_SECRET`),
  qui valide et écrit la liste vivante sur R2 (écriture conditionnelle : un
  code ajouté par le staff et une sauvegarde de l'admin ne s'écrasent jamais).
- **Contrat HTTP de l'ancien bot** (`/reviews`, `/reviews/:slug`, `/health`),
  étendu : `/reviews/:id` accepte aussi l'id du perso (une clé faite de
  chiffres) ; un slug est résolu en id par la liste de persos en cache, avec
  repli sur le slug écrit en base. Le résumé `/reviews` reste par slug.

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
