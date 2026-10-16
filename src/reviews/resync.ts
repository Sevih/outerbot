/**
 * Resync — reconstruction COMPLÈTE de l'index depuis Discord, qui reste la
 * seule source de vérité. Sert à la migration initiale (threads créés par le
 * bot V2) et à la réparation (DB perdue, doute sur l'état).
 *
 * Deux différences assumées avec le rebuild du bot V2 :
 *   - TOUS les messages sont lus (pagination par `before`), pas les 100
 *     derniers — aucun thread actif n'a vocation à perdre ses vieilles reviews ;
 *   - le mapping thread → perso (id) passe par la DB quand il existe, et ne
 *     DÉRIVE du nom du thread qu'en dernier recours (threads hérités de la V2),
 *     résolu contre les NOMS de l'API wiki — un thread irrésoluble est signalé,
 *     jamais deviné. Le slug écrit est celui que le site donne aujourd'hui à
 *     cet id (renommage compris), sinon celui de la DB.
 *
 * Écriture ATOMIQUE en fin de scan (`store.replaceAll`) : un resync interrompu
 * ne laisse jamais une base à moitié vide. Le forum-sync attend la fin du
 * resync (verrou partagé, cf. index-lock.ts) : un post qu'il créerait pendant
 * le scan serait effacé par cette réécriture.
 *
 * Même index que le direct : un membre garde sa PLUS ANCIENNE review au format
 * (le direct garde la première et efface les suivantes), et le score ne compte
 * pas la réaction du bot, seulement si elle est là.
 */
import {
  ChannelType,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type AnyThreadChannel,
  type Client,
  type ForumChannel,
  type Message,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { NewReview, Store } from '../db/store.js';
import { wiki } from '../wiki/client.js';
import { fillCharacterIds } from './forum-sync.js';
import { parseReview, reviewGate, sanitizeReviewText, scoreFromReactions } from './core.js';
import { withIndexLock } from './index-lock.js';

export interface ResyncReport {
  threads: number;
  reviews: number;
  /** Messages au bon format écartés par `reviewGate` (âge de compte, rôle). */
  refused: number;
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

/**
 * Rôles de l'auteur d'un message relu, mis en cache par utilisateur. Un message
 * lu par l'API REST ne porte pas son membre : on le demande au serveur. `null`
 * = plus membre du serveur ; toute autre erreur remonte (scan du thread
 * incomplet, signalé), plutôt que d'écarter une review à tort.
 */
function memberRolesResolver(forum: ForumChannel) {
  const byUser = new Map<string, string[] | null>();
  return async (message: Message): Promise<string[] | null> => {
    const userId = message.author.id;
    if (!byUser.has(userId)) {
      const member =
        message.member ??
        (await forum.guild.members.fetch(userId).catch((e: unknown) => {
          if (e instanceof DiscordAPIError && e.code === RESTJSONErrorCodes.UnknownMember)
            return null;
          throw e;
        }));
      byUser.set(userId, member ? [...member.roles.cache.keys()] : null);
    }
    return byUser.get(userId)!;
  };
}

/**
 * La plus ancienne review au format de chaque membre dans un fil. Discord rend
 * les messages du plus récent au plus ancien : on compare les dates. Un scan
 * interrompu garde ce qu'il a déjà lu (signalé).
 */
async function firstReviewByUser(
  thread: AnyThreadChannel,
): Promise<Map<string, { message: Message; rating: number; text: string }>> {
  const first = new Map<string, { message: Message; rating: number; text: string }>();
  try {
    for await (const message of allMessages(thread)) {
      if (message.author.bot) continue;
      const parsed = parseReview(message.content);
      if (!parsed) continue;
      const text = sanitizeReviewText(parsed.text, config.reviews.maxTextLength);
      if (!text) continue;
      const seen = first.get(message.author.id);
      if (!seen || message.createdTimestamp < seen.message.createdTimestamp) {
        first.set(message.author.id, { message, rating: parsed.rating, text });
      }
    }
  } catch (e) {
    logger.warn(`resync : scan du thread « ${thread.name} » incomplet`, e);
  }
  return first;
}

export function resyncFromDiscord(client: Client, store: Store): Promise<ResyncReport> {
  return withIndexLock(() => rebuildIndex(client, store));
}

async function rebuildIndex(client: Client, store: Store): Promise<ResyncReport> {
  const forum = (await client.channels.fetch(config.reviews.forumChannelId)) as ForumChannel;
  if (forum?.type !== ChannelType.GuildForum) {
    throw new Error(`resync : ${config.reviews.forumChannelId} n'est pas un forum`);
  }

  // Résolutions de perso : DB d'abord (ids remplis avant lecture), sinon nom du
  // thread ↔ nom wiki (héritage V2).
  const characters = await wiki.getCharacters(true);
  fillCharacterIds(store, characters);
  const idByName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
  const slugById = new Map(characters.map((c) => [c.id, c.slug]));
  const knownByThread = new Map(store.allThreads().map((t) => [t.threadId, t]));

  const threads: { threadId: string; characterId: string | null; slug: string }[] = [];
  const reviews: NewReview[] = [];
  const unresolved: string[] = [];
  let refused = 0;
  const memberRoles = memberRolesResolver(forum);
  // Sans rôle requis, inutile d'interroger le serveur pour chaque auteur.
  const needRoles = config.reviews.allowedRoleIds.length > 0;
  const now = Date.now();

  for (const thread of await fetchAllThreads(forum)) {
    const known = knownByThread.get(thread.id);
    const characterId = known?.characterId ?? idByName.get(thread.name.toLowerCase()) ?? null;
    // Un post connu dont le slug reste sans id (/status le montre) est gardé tel quel.
    const slug = (characterId && slugById.get(characterId)) || known?.slug;
    if (!slug) {
      unresolved.push(thread.name);
      continue;
    }
    threads.push({ threadId: thread.id, characterId, slug });

    try {
      for (const { message, rating, text } of (await firstReviewByUser(thread)).values()) {
        // Même garde-fou que le dépôt en direct (listener).
        const gate = reviewGate(
          message.author.createdTimestamp,
          needRoles ? await memberRoles(message) : null,
          now,
          config.reviews,
        );
        if (!gate.allowed) {
          refused++;
          continue;
        }
        reviews.push({
          messageId: message.id,
          threadId: thread.id,
          characterId,
          slug,
          userId: message.author.id,
          username: message.author.username,
          displayName: message.member?.displayName ?? message.author.displayName,
          avatar: message.author.avatar,
          rating,
          text,
          score: scoreFromReactions(
            message.reactions.cache.get('👍'),
            message.reactions.cache.get('👎'),
          ),
          createdAt: message.createdAt.toISOString(),
        });
      }
    } catch (e) {
      logger.warn(`resync : auteurs du thread « ${thread.name} » non vérifiés`, e);
    }
  }

  store.replaceAll(threads, reviews);
  store.setMeta('lastResync', new Date().toISOString());

  const report = { threads: threads.length, reviews: reviews.length, refused, unresolved };
  logger.info('resync terminé', report);
  return report;
}
