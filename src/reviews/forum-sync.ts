/**
 * Forum-sync — LA fin de la procédure manuelle du bot V2 (« npm run update »,
 * commit, push, restart PM2 à chaque perso).
 *
 * Compare les persos du wiki (API interne) aux posts déjà mappés en DB, et
 * crée les posts forum MANQUANTS : tags élément/classe/rareté, message
 * d'accueil avec le format attendu et le lien wiki. Le slug canonique est posé
 * en DB à la création — jamais déduit du nom du post.
 *
 * Tourne au boot, puis en cron (config.syncIntervalMs), et à la demande via
 * /sync. Réentrance : un seul sync à la fois (verrou process).
 */
import { ChannelType, type Client, type ForumChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { wiki, type WikiCharacter } from '../wiki/client.js';

/** Délai entre deux créations de posts (rate limit Discord). */
const CREATE_DELAY_MS = 2000;

const ELEMENT_EMOJIS: Record<string, string> = {
  fire: '<:fire:1384065720073322547>',
  water: '<:water:1384065729422426122>',
  earth: '<:earth:1384065717980106752>',
  light: '<:light:1384065721914490920>',
  dark: '<:dark:1384065716126351462>',
};
const CLASS_EMOJIS: Record<string, string> = {
  striker: '<:striker:1384065877741273098>',
  healer: '<:healer:1384065868417339524>',
  mage: '<:mage:1384065869939740784>',
  defender: '<:defender:1384065865376596059>',
  ranger: '<:ranger:1384065872787669092>',
};

function welcomeMessage(c: WikiCharacter): string {
  const el = ELEMENT_EMOJIS[c.element] ?? c.element;
  const cl = CLASS_EMOJIS[c.class] ?? c.class;
  const stars = '⭐'.repeat(c.rarity || 1);
  return [
    `${stars} ${el} **${cap(c.element)}** • ${cl} **${cap(c.class)}**`,
    '',
    '📝 **How to review:**',
    '```',
    'X/5',
    'Your review here',
    '```',
    '',
    `🔗 [View on Outerpedia](${config.siteBaseUrl}/characters/${c.slug})`,
  ].join('\n');
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface SyncReport {
  created: string[];
  failed: string[];
  total: number;
}

let syncing = false;

/** Crée les posts forum manquants ; renvoie le rapport (pour /sync et le log). */
export async function syncForumPosts(
  client: Client,
  store: Store,
  force = false,
): Promise<SyncReport> {
  if (syncing) return { created: [], failed: [], total: 0 };
  syncing = true;
  try {
    const characters = await wiki.getCharacters(force);
    const known = store.knownSlugs();
    const missing = characters.filter((c) => !known.has(c.slug));
    const report: SyncReport = { created: [], failed: [], total: characters.length };
    if (missing.length === 0) {
      // Un passage SANS rien à créer est un sync réussi : il se date aussi
      // (sinon /status et /health affichent « jamais synchronisé » à vie).
      store.setMeta('lastForumSync', new Date().toISOString());
      return report;
    }

    const forum = (await client.channels.fetch(config.reviews.forumChannelId)) as ForumChannel;
    if (forum?.type !== ChannelType.GuildForum) {
      throw new Error(`forum-sync : ${config.reviews.forumChannelId} n'est pas un forum`);
    }

    // Tags du forum par nom normalisé (élément/classe/rareté déjà créés).
    const tagIds = new Map<string, string>();
    for (const tag of forum.availableTags) tagIds.set(tag.name.toLowerCase(), tag.id);

    for (const c of missing) {
      const appliedTags = [
        tagIds.get(c.element.toLowerCase()),
        tagIds.get(c.class.toLowerCase()),
        tagIds.get('★'.repeat(c.rarity)),
      ].filter((t): t is string => Boolean(t));

      try {
        const thread = await forum.threads.create({
          name: c.name,
          autoArchiveDuration: 10080, // 1 semaine — l'archivage n'enlève rien au mapping
          rateLimitPerUser: 60, // slow mode : 1 message / 60 s
          message: { content: welcomeMessage(c) },
          appliedTags,
        });
        store.registerThread(thread.id, c.slug);
        report.created.push(c.slug);
        logger.info('post forum créé', { slug: c.slug, threadId: thread.id });
      } catch (e) {
        report.failed.push(c.slug);
        logger.error(`création du post ${c.slug} échouée`, e);
      }
      await new Promise((r) => setTimeout(r, CREATE_DELAY_MS));
    }

    store.setMeta('lastForumSync', new Date().toISOString());
    return report;
  } finally {
    syncing = false;
  }
}

/** Cron du sync — démarre la boucle périodique (et un premier passage). */
export function startForumSyncLoop(client: Client, store: Store): NodeJS.Timeout {
  void syncForumPosts(client, store).catch((e) => logger.error('forum-sync initial échoué', e));
  return setInterval(() => {
    void syncForumPosts(client, store, true).catch((e) =>
      logger.error('forum-sync périodique échoué', e),
    );
  }, config.syncIntervalMs);
}
