/**
 * API HTTP — le contrat que le SITE consomme, IDENTIQUE au bot V2 (le code V3
 * de la section Reviews se branche sans adaptation) :
 *   GET /reviews         → { slug: { count, average } }  (résumé global)
 *   GET /reviews/:slug   → Review[]                       (tri score/récence)
 *   GET /health          → état (healthcheck Docker)
 * Réseau INTERNE uniquement (jamais exposée par Caddy) — pas d'auth, pas de
 * CORS : le seul client est le conteneur du site.
 */
import { createServer, type Server } from 'node:http';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { wiki } from '../wiki/client.js';

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
        threads: store.knownSlugs().size,
        wiki: wiki.status(),
        lastForumSync: store.getMeta('lastForumSync') ?? null,
      });
    }

    if (url.pathname === '/reviews') return json(200, store.summary());

    const slugMatch = url.pathname.match(/^\/reviews\/([a-z0-9-]+)$/);
    if (slugMatch) return json(200, store.reviewsFor(slugMatch[1]!));

    return json(404, { error: 'not found' });
  });

  server.listen(config.http.port, () => {
    logger.info(`API HTTP démarrée sur :${config.http.port}`);
  });
  return server;
}
