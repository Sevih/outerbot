/**
 * Annonces Discord des nouveautés du site : codes promo et journal (`/changelog`).
 *
 * Le bot VA CHERCHER (routes `/api/bot/coupons|changelog`) plutôt que d'être
 * prévenu : l'admin du site tourne en dev sur le poste de Sevih et ne voit pas
 * le réseau Docker du VPS. Et ces routes appliquent déjà les règles de mise en
 * ligne du site — un coupon n'y entre qu'à sa date de début, une entrée du
 * journal qu'une fois déployée et à sa date. Le bot annonce donc ce que le site
 * AFFICHE, au moment où il l'affiche.
 *
 * Premier passage par type (base neuve ou perdue) : tout ce qui est servi est
 * marqué vu SANS rien poster — sinon, tout l'historique partirait d'un coup.
 */
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIEmbed,
  Client,
  SendableChannels,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { wiki } from '../wiki/client.js';
import {
  couponButtons,
  couponEmbed,
  couponKey,
  newCoupons,
  newNews,
  newsEmbed,
  newsKey,
  type AnnounceKind,
} from './core.js';

/** Délai entre deux messages (rate limit Discord). */
const POST_DELAY_MS = 1500;

const seededMeta = (kind: AnnounceKind): string => `announce.seeded.${kind}`;

interface Pending {
  key: string;
  embed: APIEmbed;
  components?: APIActionRowComponent<APIButtonComponent>[];
}

interface Source {
  kind: AnnounceKind;
  /** Toutes les clés servies (pour l'amorçage) + ce qui est à annoncer. */
  load(seen: Set<string>, today: string): Promise<{ all: string[]; pending: Pending[] }>;
}

const SOURCES: Source[] = [
  {
    kind: 'coupon',
    async load(seen) {
      const coupons = await wiki.fetchCoupons();
      return {
        all: coupons.map(couponKey),
        pending: newCoupons(coupons, seen).map((c) => ({
          key: couponKey(c),
          embed: couponEmbed(c, config.siteBaseUrl),
          components: [couponButtons()],
        })),
      };
    },
  },
  {
    kind: 'news',
    async load(seen, today) {
      const entries = await wiki.fetchChangelog();
      return {
        all: entries.map(newsKey),
        pending: newNews(entries, seen, today).map((e) => ({
          key: newsKey(e),
          embed: newsEmbed(e, config.siteBaseUrl, config.imgBaseUrl),
        })),
      };
    },
  },
];

async function announceChannel(client: Client): Promise<SendableChannels> {
  const channel = await client.channels.fetch(config.announce.channelId);
  if (!channel?.isSendable()) {
    throw new Error(`annonces : ${config.announce.channelId} n'est pas un salon où poster`);
  }
  return channel;
}

let running = false;

/**
 * Un passage. La lecture est indépendante par type (une route en erreur
 * n'empêche pas l'autre) ; un échec d'ENVOI arrête le passage — le salon est
 * commun, et tout est retenté au suivant.
 */
export async function runAnnouncements(client: Client, store: Store): Promise<void> {
  if (running) return;
  running = true;
  try {
    const today = new Date().toISOString().slice(0, 10);
    let channel: SendableChannels | undefined;

    for (const source of SOURCES) {
      const seen = store.announcedKeys(source.kind);
      let loaded: Awaited<ReturnType<Source['load']>>;
      try {
        loaded = await source.load(seen, today);
      } catch (e) {
        logger.warn(`annonces ${source.kind} : lecture du site échouée`, e);
        continue;
      }

      if (!store.getMeta(seededMeta(source.kind))) {
        store.markAnnounced(source.kind, loaded.all);
        store.setMeta(seededMeta(source.kind), new Date().toISOString());
        logger.info(
          `annonces ${source.kind} : amorçage, ${loaded.all.length} entrées marquées vues`,
        );
        continue;
      }

      for (const item of loaded.pending) {
        channel ??= await announceChannel(client);
        // Marqué APRÈS l'envoi : un échec est retenté au passage suivant ; on
        // s'arrête au premier pour ne pas reposter dans le désordre.
        await channel.send({ embeds: [item.embed], components: item.components ?? [] });
        store.markAnnounced(source.kind, [item.key]);
        logger.info(`annonce ${source.kind} postée`, { key: item.key });
        await new Promise((r) => setTimeout(r, POST_DELAY_MS));
      }
    }
    store.setMeta('lastAnnounceCheck', new Date().toISOString());
  } finally {
    running = false;
  }
}

/** Démarre la boucle (et un premier passage), si un salon est configuré. */
export function startAnnounceLoop(client: Client, store: Store): NodeJS.Timeout | undefined {
  if (!config.announce.channelId) {
    logger.info('annonces coupées : ANNOUNCE_CHANNEL_ID absent');
    return undefined;
  }
  const tick = (): void => {
    void runAnnouncements(client, store).catch((e) => logger.error('annonces : passage échoué', e));
  };
  tick();
  return setInterval(tick, config.announce.intervalMs);
}
