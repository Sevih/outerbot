/**
 * Rate limiter par utilisateur — fenêtre glissante en mémoire. Protège les
 * commandes slash du spam (même rôle que celui du bot V2, sans le cleanup
 * périodique : la purge se fait à la consultation).
 */
const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 10;

const hits = new Map<string, number[]>();

/** Consomme un jeton ; refus = temps d'attente en secondes. */
export function consume(userId: string): { allowed: true } | { allowed: false; retryInS: number } {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_IN_WINDOW) {
    const retryInS = Math.ceil((WINDOW_MS - (now - list[0]!)) / 1000);
    hits.set(userId, list);
    return { allowed: false, retryInS };
  }
  list.push(now);
  hits.set(userId, list);
  return { allowed: true };
}
