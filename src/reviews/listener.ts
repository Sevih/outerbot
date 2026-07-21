/**
 * Listener du forum reviews — traduit les events Discord en mutations du store.
 *
 * Cycle de vie d'une review :
 *   message dans un thread du forum  → parse X/5 → store + réactions ✅👍👎 ;
 *   réaction 👍/👎 (hors bot)        → ±1 sur le score ;
 *   message supprimé                 → review supprimée.
 * Un message invalide est expliqué puis effacé (le thread reste propre) ; un
 * thread inconnu du mapping est ignoré en silence.
 */
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import { Events } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { parseReview, sanitizeReviewText, type ReviewRejection } from './core.js';

const REJECTION_MESSAGES: Record<ReviewRejection, string | null> = {
  duplicate: '⚠️ You already have a review for this character. Delete your previous one first.',
  bad_format:
    '❌ Invalid format. Please use:\n```\nX/5\nYour review text here (at least 3 characters)\n```',
  empty_after_sanitize: '❌ Your review text is empty after sanitization.',
  unknown_thread: null, // pas un thread de review — silence
};

/** Garde-fous de dépôt (âge de compte, rôles) — mêmes règles que le bot V2. */
function canPostReview(message: Message): { allowed: boolean; reason?: string } {
  const accountAgeMs = Date.now() - message.author.createdTimestamp;
  const minMs = config.reviews.minAccountAgeDays * 24 * 60 * 60 * 1000;
  if (accountAgeMs < minMs) {
    return {
      allowed: false,
      reason: `Your Discord account must be at least ${config.reviews.minAccountAgeDays} days old to post reviews.`,
    };
  }
  if (config.reviews.allowedRoleIds.length > 0 && message.member) {
    const ok = config.reviews.allowedRoleIds.some((id) => message.member!.roles.cache.has(id));
    if (!ok)
      return { allowed: false, reason: 'You do not have the required role to post reviews.' };
  }
  return { allowed: true };
}

/** Répond, laisse lire, puis efface la question ET la réponse. */
async function explainAndDelete(message: Message, text: string, ttlMs: number): Promise<void> {
  try {
    const reply = await message.reply({ content: text });
    setTimeout(() => void reply.delete().catch(() => {}), ttlMs);
    await message.delete().catch(() => {});
  } catch {
    /* le message a pu disparaître entre-temps */
  }
}

/** Tente le dépôt d'une review depuis un message ; renvoie l'erreur éventuelle. */
export function tryAddReview(store: Store, message: Message): ReviewRejection | null {
  const slug = store.slugForThread(message.channelId);
  if (!slug) return 'unknown_thread';
  if (store.hasReview(slug, message.author.id)) return 'duplicate';

  const parsed = parseReview(message.content);
  if (!parsed) return 'bad_format';

  const text = sanitizeReviewText(parsed.text, config.reviews.maxTextLength);
  if (!text) return 'empty_after_sanitize';

  store.addReview({
    messageId: message.id,
    threadId: message.channelId,
    slug,
    userId: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName ?? message.author.displayName,
    avatar: message.author.avatar,
    rating: parsed.rating,
    text,
    createdAt: message.createdAt.toISOString(),
  });
  logger.info('review ajoutée', { slug, userId: message.author.id, rating: parsed.rating });
  return null;
}

/** Branche tous les events du forum reviews sur le client. */
export function attachReviewListeners(client: Client, store: Store): void {
  const inForum = (parentId: string | null | undefined): boolean =>
    parentId === config.reviews.forumChannelId;

  // Rejoindre les nouveaux posts (nécessaire pour recevoir leurs messages).
  client.on(Events.ThreadCreate, (thread) => {
    if (inForum(thread.parentId) && !thread.joined) void thread.join().catch(() => {});
  });

  const onMessage = async (message: Message): Promise<void> => {
    if (message.author.bot) return;
    if (!inForum(message.channel.isThread() ? message.channel.parentId : null)) return;

    const gate = canPostReview(message);
    if (!gate.allowed) {
      await explainAndDelete(message, `❌ ${gate.reason}`, 10_000);
      return;
    }

    const rejection = tryAddReview(store, message);
    if (rejection === null) {
      // Amorce des votes — le resync sait que ces deux-là sont du bot.
      await message.react('✅').catch(() => {});
      await message.react('👍').catch(() => {});
      await message.react('👎').catch(() => {});
      return;
    }
    const explain = REJECTION_MESSAGES[rejection];
    if (explain) await explainAndDelete(message, explain, 15_000);
  };
  client.on(Events.MessageCreate, (message) => {
    void onMessage(message).catch((e) => logger.error('listener messageCreate en erreur', e));
  });

  client.on(Events.MessageDelete, (message: Message | PartialMessage) => {
    const parentId = message.channel?.isThread() ? message.channel.parentId : null;
    if (!inForum(parentId)) return;
    if (store.removeReviewByMessage(message.id)) {
      logger.info('review supprimée (message effacé)', { messageId: message.id });
    }
  });

  const onReaction = (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    isAdd: boolean,
  ): void => {
    if (user.bot) return;
    const parentId = reaction.message.channel?.isThread()
      ? reaction.message.channel.parentId
      : null;
    if (!inForum(parentId)) return;
    const emoji = reaction.emoji.name;
    if (emoji !== '👍' && emoji !== '👎') return;
    const delta = (emoji === '👍' ? 1 : -1) * (isAdd ? 1 : -1);
    store.applyVote(reaction.message.id, delta);
  };

  client.on(Events.MessageReactionAdd, (reaction, user) => onReaction(reaction, user, true));
  client.on(Events.MessageReactionRemove, (reaction, user) => onReaction(reaction, user, false));
}
