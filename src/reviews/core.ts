/**
 * Cœur des reviews — fonctions PURES (aucune dépendance Discord ni DB), donc
 * testées à sec. La logique de parse/sanitize est PORTÉE du bot V2 éprouvé :
 * le format `X/5` en première ligne et ses tolérances (étoiles décoratives,
 * slash pleine chasse) sont un CONTRAT avec les utilisateurs du forum — on ne
 * le resserre pas.
 */

/** Le contrat de sortie HTTP — IDENTIQUE au type `Review` de la V2/V3. */
export interface Review {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  rating: number;
  text: string;
  score: number;
  source: string;
  timestamp: string;
}

/**
 * Parse un message de review. Attendu :
 *   ligne 1 : `X/5` (note, décimale tolérée, étoiles décoratives tolérées) ;
 *   la suite : le texte.
 * `null` si ce n'est pas une review (le listener ignore alors ou explique).
 */
export function parseReview(content: string): { rating: number; text: string } | null {
  if (!content.trim()) return null;

  const lines = content.trim().split('\n');
  const firstLine = lines[0]!.trim();

  // « 4/5 », « ⭐ 4.5/5 », « 4,5/5 », « 3／5 » (slash pleine chasse des claviers
  // CJK)… L'étoile peut porter le sélecteur de variante U+FE0F (« ⭐️ », inséré
  // par beaucoup de claviers mobiles). Rien ne suit le 5 : « 4/50 » n'est pas 4/5.
  const ratingMatch = firstLine.match(/^[\uFE0F⭐★☆\s]*(\d(?:[.,]\d)?)\s*[/／]\s*5(?!\d)/);
  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1]!.replace(',', '.'));
  if (rating < 1 || rating > 5) return null;

  const text = lines.slice(1).join('\n').trim();
  if (text.length < 3) return null;

  return { rating, text };
}

/**
 * Nettoie le texte d'une review : liens et mentions retirés (le site rend le
 * texte tel quel — rien d'exécutable ne doit passer), emojis custom CONSERVÉS
 * (rendus en images par la section du site), lignes vides compactées, borné.
 */
export function sanitizeReviewText(text: string, maxLength: number): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/@(everyone|here)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Coupe par caractère (point de code), jamais au milieu d'un emoji.
  return Array.from(cleaned).slice(0, maxLength).join('').trim();
}

/** Ce que Discord dit d'une réaction : nombre total, et si le bot en est. */
export interface ReactionTally {
  count: number;
  /** Le bot lui-même a posé cette réaction (son amorce). */
  me: boolean;
}

/**
 * Score d'un message relu depuis Discord : votes 👍 moins votes 👎, SANS la
 * réaction du bot. On retire la sienne seulement si elle est là (`me`) : une
 * amorce ratée ou retirée à la main ne fausse plus le score de 1. Réaction
 * absente = aucun vote.
 */
export function scoreFromReactions(
  up: ReactionTally | undefined,
  down: ReactionTally | undefined,
): number {
  const votes = (r: ReactionTally | undefined): number =>
    r ? Math.max(0, r.count - (r.me ? 1 : 0)) : 0;
  return votes(up) - votes(down);
}

/** Règles de dépôt (issues de la config) que `reviewGate` applique. */
export interface ReviewRules {
  minAccountAgeDays: number;
  /** Vide = tout le monde. */
  allowedRoleIds: readonly string[];
}

/**
 * Qui peut avoir une review dans l'index : compte assez ancien et, si des rôles
 * sont configurés, l'un d'eux. Même règle pour le dépôt en direct et pour le
 * resync. `memberRoleIds` à `null` = membre introuvable (parti du serveur) :
 * refusé dès que des rôles sont requis.
 */
export function reviewGate(
  authorCreatedAt: number,
  memberRoleIds: readonly string[] | null,
  now: number,
  rules: ReviewRules,
): { allowed: true } | { allowed: false; reason: string } {
  const minMs = rules.minAccountAgeDays * 24 * 60 * 60 * 1000;
  if (now - authorCreatedAt < minMs) {
    return {
      allowed: false,
      reason: `Your Discord account must be at least ${rules.minAccountAgeDays} days old to post reviews.`,
    };
  }
  if (
    rules.allowedRoleIds.length > 0 &&
    !rules.allowedRoleIds.some((id) => memberRoleIds?.includes(id))
  ) {
    return { allowed: false, reason: 'You do not have the required role to post reviews.' };
  }
  return { allowed: true };
}

/** Erreurs de dépôt — le listener les traduit en messages utilisateur. */
export type ReviewRejection =
  'duplicate' | 'bad_format' | 'empty_after_sanitize' | 'unknown_thread';
