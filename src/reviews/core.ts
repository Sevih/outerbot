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

  // « 4/5 », « ⭐ 4.5/5 », « 3／5 » (slash pleine chasse des claviers CJK)…
  const ratingMatch = firstLine.match(/^[⭐★☆\s]*(\d(?:\.\d)?)\s*[/／]\s*5/);
  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1]!);
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
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/@(everyone|here)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .substring(0, maxLength)
    .trim();
}

/**
 * Score d'un message re-scanné depuis Discord : réactions 👍/👎 MOINS celles
 * du bot lui-même (il amorce chaque review avec les deux). Le resync passe par
 * ici — même règle que la V2.
 */
export function scoreFromReactions(upvotes: number, downvotes: number): number {
  return Math.max(0, upvotes - 1) - Math.max(0, downvotes - 1);
}

/** Erreurs de dépôt — le listener les traduit en messages utilisateur. */
export type ReviewRejection =
  'duplicate' | 'bad_format' | 'empty_after_sanitize' | 'unknown_thread';
