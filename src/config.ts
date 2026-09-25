/**
 * Configuration — TOUT l'environnement est lu et validé ICI, une fois, au
 * démarrage. Un secret manquant fait échouer le boot immédiatement (fail-fast)
 * plutôt que 3 minutes plus tard au premier appel Discord — le bot V2 démarrait
 * avec des valeurs vides et échouait en silence (cf. son config.js qui devait
 * re-charger dotenv « au cas où »).
 *
 * Pas de dotenv en prod : les variables viennent du conteneur (secrets SOPS de
 * la stack). En dev, `tsx --env-file=.env` ou un export shell suffisent.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`config : variable d'environnement requise absente : ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** Liste CSV → tableau (vide si absente). */
function csv(name: string, fallback = ''): string[] {
  return optional(name, fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('CLIENT_ID'),
    guildId: required('GUILD_ID'),
    adminUserId: required('ADMIN_USER_ID'),
  },

  reviews: {
    /** Forum #hero-reviews — un post par perso. */
    forumChannelId: required('REVIEW_FORUM_ID'),
    /** Âge de compte minimal pour poster (jours). */
    minAccountAgeDays: Number(optional('REVIEW_MIN_AGE_DAYS', '30')),
    /** Rôles requis pour poster (vide = tout le monde). */
    allowedRoleIds: csv('REVIEW_ROLE_IDS'),
    /** Guilds dont les emojis custom sont autorisés dans le texte. */
    allowedEmojiGuildIds: csv('REVIEW_EMOJI_GUILDS'),
    /** Longueur max du texte d'une review. */
    maxTextLength: 1000,
  },

  /** API interne du site (réseau Docker en prod). */
  wikiApiUrl: optional('WIKI_API_URL', 'http://localhost:3000').replace(/\/$/, ''),

  /** URL publique du wiki (liens dans les embeds). */
  siteBaseUrl: optional('SITE_BASE_URL', 'https://outerpedia.com').replace(/\/$/, ''),

  /** CDN images du wiki (vignettes des embeds). */
  imgBaseUrl: optional('IMG_BASE_URL', 'https://img.outerpedia.com').replace(/\/$/, ''),

  http: {
    port: Number(optional('HTTP_PORT', '3001')),
  },

  db: {
    path: optional('DB_PATH', 'data/outerbot.sqlite'),
  },

  /** Cadence du sync automatique persos → posts forum (ms). */
  syncIntervalMs: Number(optional('SYNC_INTERVAL_HOURS', '6')) * 60 * 60 * 1000,

  coupons: {
    /** Rôles staff autorisés à /coupon (l'admin du bot l'est toujours). */
    staffRoleIds: csv('STAFF_ROLE_IDS'),
    /**
     * Jeton partagé avec la route interne du site (`/api/internal/coupons`).
     * Vide = /coupon répond « non configurée » ; le bot démarre quand même.
     */
    apiSecret: optional('COUPON_API_SECRET', ''),
  },

  announce: {
    /**
     * Salon des annonces (coupons + journal du site). Vide = fonction coupée :
     * le bot démarre sans, pour qu'un déploiement ne dépende pas de l'ajout de
     * la variable dans la stack.
     */
    channelId: optional('ANNOUNCE_CHANNEL_ID', ''),
    /**
     * Cadence de la vérification (ms). Les routes du site n'ont aucun cache :
     * c'est le SEUL délai entre la sauvegarde d'un code et son annonce.
     */
    intervalMs: Number(optional('ANNOUNCE_INTERVAL_SECONDS', '60')) * 1000,
  },
} as const;

export type Config = typeof config;
