/**
 * Resync — reconstruction COMPLÈTE de l'index depuis Discord, qui reste la
 * seule source de vérité. Sert à la migration initiale (threads créés par le
 * bot V2) et à la réparation (DB perdue, doute sur l'état).
 *
 * Deux différences assumées avec le rebuild du bot V2 :
 *   - TOUS les messages sont lus (pagination par `before`), pas les 100
 *     derniers — aucun thread actif n'a vocation à perdre ses vieilles reviews ;
 *   - le mapping thread → slug passe par la DB quand il existe, et ne DÉRIVE du
 *     nom du thread qu'en dernier recours (threads hérités de la V2), résolu
 *     contre les NOMS de l'API wiki — un thread irrésoluble est signalé, jamais
 *     deviné.
 *
 * Écriture ATOMIQUE en fin de scan (`store.replaceAll`) : un resync interrompu
 * ne laisse jamais une base à moitié vide.
 */
import { ChannelType, type AnyThreadChannel, type Client, type ForumChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { NewReview, Store } from '../db/store.js';
import { wiki } from '../wiki/client.js';
import { parseReview, sanitizeReviewText, scoreFromReactions } from './core.js';

export interface ResyncReport {
  threads: number;
  reviews: number;
  /** Threads du forum qu'on n'a pas su relier à un perso (à /link à la main). */
  unresolved: string[];
}

/** Tous les threads du forum, actifs ET archivés (paginés). */
async function fetchAllThreads(forum: ForumChannel): Promise<AnyThreadChannel[]> {
  const out = new Map<string, AnyThreadChannel>();

  const active = await forum.threads.fetch();
  for (const t of active.threads.values()) out.set(t.id, t);

  let before: number | undefined;
  for (;;) {
    const page = await forum.threads.fetchArchived({ limit: 100, ...(before ? { before } : {}) });
    if (page.threads.size === 0) break;
    for (const t of page.threads.values()) {
      out.set(t.id, t);
      before = t.archiveTimestamp ?? before;
    }
    if (!page.hasMore) break;
  }
  return [...out.values()];
}

/** Tous les messages d'un thread (pagination par `before` — pas de limite 100). */
async function* allMessages(thread: AnyThreadChannel) {
  let before: string | undefined;
  for (;;) {
    const page = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (page.size === 0) return;
    for (const m of page.values()) yield m;
    before = page.last()!.id;
    if (page.size < 100) return;
  }
}

export async function resyncFromDiscord(client: Client, store: Store): Promise<ResyncReport> {
  const forum = (await client.channels.fetch(config.reviews.forumChannelId)) as ForumChannel;
  if (forum?.type !== ChannelType.GuildForum) {
    throw new Error(`resync : ${config.reviews.forumChannelId} n'est pas un forum`);
  }

  // Résolutions de slug : DB d'abord, sinon nom du thread ↔ nom wiki (héritage V2).
  const characters = await wiki.getCharacters(true);
  const slugByName = new Map(characters.map((c) => [c.name.toLowerCase(), c.slug]));
  const knownByThread = new Map(store.allThreads().map((t) => [t.threadId, t.slug]));

  const threads: { threadId: string; slug: string }[] = [];
  const reviews: NewReview[] = [];
  const unresolved: string[] = [];

  for (const thread of await fetchAllThreads(forum)) {
    const slug = knownByThread.get(thread.id) ?? slugByName.get(thread.name.toLowerCase());
    if (!slug) {
      unresolved.push(thread.name);
      continue;
    }
    threads.push({ threadId: thread.id, slug });

    const seenUsers = new Set<string>();
    try {
      for await (const message of allMessages(thread)) {
        if (message.author.bot) continue;
        const parsed = parseReview(message.content);
        if (!parsed) continue;
        const text = sanitizeReviewText(parsed.text, config.reviews.maxTextLength);
        if (!text) continue;
        if (seenUsers.has(message.author.id)) continue; // un user, une review
        seenUsers.add(message.author.id);

        const up = message.reactions.cache.get('👍')?.count ?? 0;
        const down = message.reactions.cache.get('👎')?.count ?? 0;
        reviews.push({
          messageId: message.id,
          threadId: thread.id,
          slug,
          userId: message.author.id,
          username: message.author.username,
          displayName: message.member?.displayName ?? message.author.displayName,
          avatar: message.author.avatar,
          rating: parsed.rating,
          text,
          score: scoreFromReactions(up, down),
          createdAt: message.createdAt.toISOString(),
        });
      }
    } catch (e) {
      logger.warn(`resync : scan du thread « ${thread.name} » incomplet`, e);
    }
  }

  store.replaceAll(threads, reviews);
  store.setMeta('lastResync', new Date().toISOString());

  const report = { threads: threads.length, reviews: reviews.length, unresolved };
  logger.info('resync terminé', report);
  return report;
}
