/**
 * API HTTP — le contrat que le SITE consomme, IDENTIQUE au bot V2 (le code V3
 * de la section Reviews se branche sans adaptation) :
 *   GET /reviews         → { slug: { count, average } }  (résumé global)
 *   GET /reviews/:clé    → Review[]                       (tri score/récence)
 *                          clé = id du perso (chiffres) ou slug
 *   GET /health          → état (healthcheck Docker)
 * Réseau INTERNE uniquement (jamais exposée par Caddy) — pas d'auth, pas de
 * CORS : le seul client est le conteneur du site.
 */
import { createServer, type Server } from 'node:http';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import type { Review } from '../reviews/core.js';
import { wiki, type WikiCharacter } from '../wiki/client.js';

/**
 * `/reviews/<clé>` : une clé faite de chiffres est un id (le site garantit
 * qu'aucun slug ne l'est) ; sinon un slug, résolu en id par la liste de persos
 * en cache, avec les lignes de ce slug pas encore remplies. Slug inconnu de la
 * liste, ou pas de liste (site injoignable depuis le démarrage) : la colonne
 * slug.
 */
export function reviewsForKey(
  store: Store,
  key: string,
  characters: readonly WikiCharacter[] | undefined,
): Review[] {
  if (/^\d+$/.test(key)) return store.reviewsFor(key);
  const id = characters?.find((c) => c.slug === key)?.id;
  return id ? store.reviewsFor(id, key) : store.reviewsForSlug(key);
}

export function startHttpServer(store: Store, client: Client): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.http.port}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });

    if (url.pathname === '/health') {
      const healthy = client.isReady();
      return json(healthy ? 200 : 503, {
        status: healthy ? 'healthy' : 'unhealthy',
        discord: client.isReady() ? 'connected' : 'disconnected',
        reviews: store.countReviews(),
        threads: store.countThreads(),
        wiki: wiki.status(),
        lastForumSync: store.getMeta('lastForumSync') ?? null,
      });
    }

    if (url.pathname === '/reviews') return json(200, store.summary());

    const keyMatch = url.pathname.match(/^\/reviews\/([a-z0-9-]+)$/);
    if (keyMatch) return json(200, reviewsForKey(store, keyMatch[1]!, wiki.peekCharacters()));

    return json(404, { error: 'not found' });
  });

  server.listen(config.http.port, () => {
    logger.info(`API HTTP démarrée sur :${config.http.port}`);
  });
  return server;
}
