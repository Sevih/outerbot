/**
 * Ce que l'index fait d'un changement Discord sur une review DÉJÀ déposée —
 * logique sans Discord ni config (testée à sec avec le store en mémoire). Le
 * listener ne fait que traduire l'événement et appeler ces fonctions.
 *
 * Règle : l'index doit rester ce qu'un resync reconstruirait à partir de
 * Discord. Une review éditée garde sa place si elle reste au format, et sort
 * de l'index sinon (le resync l'ignorerait aussi).
 */
import type { Store } from '../db/store.js';
import { parseReview, sanitizeReviewText, scoreFromReactions, type ReactionTally } from './core.js';

export type EditOutcome = 'updated' | 'removed' | 'not_a_review';

/** Message édité : la review prend la nouvelle note et le nouveau texte, ou sort. */
export function applyEdit(
  store: Store,
  messageId: string,
  content: string,
  maxTextLength: number,
): EditOutcome {
  const parsed = parseReview(content);
  const text = parsed ? sanitizeReviewText(parsed.text, maxTextLength) : '';
  if (parsed && text) {
    return store.updateReviewContent(messageId, parsed.rating, text) ? 'updated' : 'not_a_review';
  }
  return store.removeReviewByMessage(messageId) ? 'removed' : 'not_a_review';
}

/** Les réactions d'un message, telles que discord.js les range (par emoji). */
export interface ReactionLookup {
  get(emoji: string): ReactionTally | undefined;
}

/** Score recalculé depuis l'état des réactions (une réaction vidée en entier). */
export function rescoreFromReactions(
  store: Store,
  messageId: string,
  reactions: ReactionLookup,
): boolean {
  return store.setScore(messageId, scoreFromReactions(reactions.get('👍'), reactions.get('👎')));
}
