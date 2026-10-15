/**
 * Lecture CONTRÔLÉE des variables d'environnement non textuelles. Séparé de
 * `config.ts` (qui lit tout au chargement) pour être testé à sec : une valeur
 * invalide lève, et le boot échoue avec un message qui nomme la variable.
 */

/**
 * Nombre strictement positif (ou nul avec `allowZero`) ; `fallback` si la
 * variable est absente ou vide. Sans ce contrôle, `Number('6h')` donnait `NaN`
 * et `setInterval(fn, NaN)` tournait toutes les millisecondes ; `0` aussi.
 */
export function positiveNumber(
  name: string,
  fallback: number,
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) {
    const expected = allowZero ? 'un nombre positif ou nul' : 'un nombre strictement positif';
    throw new Error(`config : ${name}=${JSON.stringify(raw)} invalide, ${expected} attendu`);
  }
  return n;
}

/**
 * Une liste de rôles ne doit pas contenir l'id du serveur : c'est celui du rôle
 * @everyone, que discord.js range dans les rôles de CHAQUE membre — la liste
 * ouvrirait alors le droit à tout le monde.
 */
export function rolesWithoutGuild(name: string, roleIds: string[], guildId: string): string[] {
  if (roleIds.includes(guildId)) {
    throw new Error(
      `config : ${name} contient GUILD_ID (${guildId}), le rôle @everyone — retirer cet id`,
    );
  }
  return roleIds;
}
