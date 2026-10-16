/**
 * Forum-sync — LA fin de la procédure manuelle du bot V2 (« npm run update »,
 * commit, push, restart PM2 à chaque perso).
 *
 * Compare les persos du wiki (API interne) aux posts déjà mappés en DB, PAR
 * ID, et crée les posts forum MANQUANTS : tags élément/classe/rareté, message
 * d'accueil avec le format attendu et le lien wiki. L'id du perso (et son slug,
 * pour l'affichage) est posé en DB à la création — jamais déduit du nom du
 * post. Un perso renommé garde donc son post.
 *
 * Chaque passage commence par remplir les ids des lignes qui n'en ont pas
 * encore (base d'avant v3, cf. Store.backfillCharacterIds) : sans ça, juste
 * après la migration, aucun post ne serait connu par id et chaque perso en
 * recevrait un second.
 *
 * Tourne au boot, puis en cron (config.syncIntervalMs), et à la demande via
 * /sync. Réentrance : un seul sync à la fois (un second est ignoré), et jamais
 * pendant un resync (verrou partagé, cf. index-lock.ts : il attend la fin).
 */
import { ChannelType, type Client, type ForumChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { wiki, type WikiCharacter } from '../wiki/client.js';
import { joinUrl } from '../wiki/links.js';
import { withIndexLock } from './index-lock.js';

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

/** Message d'accueil d'un post ; sans `href` du site, la ligne de lien est omise. */
export function welcomeMessage(c: WikiCharacter, siteBaseUrl: string): string {
  const page = joinUrl(siteBaseUrl, c.href);
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
    ...(page ? ['', `🔗 [View on Outerpedia](${page})`] : []),
  ].join('\n');
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Remplit les ids manquants d'après la liste du site ; les slugs qu'elle ne
 * connaît pas sont journalisés (et montrés par /status). Appelé sous le verrou
 * de l'index, par le forum-sync et le resync.
 */
export function fillCharacterIds(store: Store, characters: readonly WikiCharacter[]): void {
  const unresolved = store.backfillCharacterIds(characters);
  if (unresolved.length) {
    logger.warn(`index : ${unresolved.length} slug(s) sans id de perso`, { unresolved });
  }
}

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
    return await withIndexLock(() => createMissingPosts(client, store, force));
  } finally {
    syncing = false;
  }
}

async function createMissingPosts(
  client: Client,
  store: Store,
  force: boolean,
): Promise<SyncReport> {
  const characters = await wiki.getCharacters(force);
  fillCharacterIds(store, characters);
  const known = store.knownCharacterIds();
  const missing = characters.filter((c) => !known.has(c.id));
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
        message: { content: welcomeMessage(c, config.siteBaseUrl) },
        appliedTags,
      });
      store.registerThread(thread.id, c.id, c.slug);
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
