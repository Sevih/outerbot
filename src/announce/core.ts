/**
 * Annonces — cœur PUR : quelles entrées sont nouvelles, et leur embed.
 * Aucun accès Discord ni réseau ici (testé tel quel, cf. test/announce.test.ts).
 */
import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
} from 'discord.js';
import type { WikiChangelogEntry, WikiCoupon } from '../wiki/client.js';
import { joinUrl } from '../wiki/links.js';

export type AnnounceKind = 'coupon' | 'news';

/**
 * Une entrée du journal plus vieille que ça n'est jamais annoncée, même
 * inconnue : un premier passage sur une clé qu'on n'a jamais marquée (une
 * entrée dont le site ne sert pas encore l'id, et dont la clé date|titre
 * change avec le titre ; une base qui a perdu l'historique) ne remonte pas
 * plus loin. Deux jours couvrent un déploiement tardif.
 */
export const NEWS_MAX_AGE_DAYS = 2;

export const couponKey = (c: WikiCoupon): string => c.code;

/**
 * Ancienne clé d'une entrée du journal, d'avant l'id servi par le site : la
 * date et le titre EN. La base de prod porte toutes les annonces passées sous
 * cette forme.
 */
export const legacyNewsKey = (e: WikiChangelogEntry): string => `${e.date}|${e.title}`;

/** Clé d'une entrée du journal : son id stable ; l'ancienne clé si le site ne le sert pas. */
export const newsKey = (e: WikiChangelogEntry): string => e.id ?? legacyNewsKey(e);

/**
 * Déjà annoncée : sous sa clé, ou sous l'ancienne (transition — sans ça, les
 * entrées récentes déjà annoncées sous date|titre repartiraient au déploiement).
 */
export const newsSeen = (e: WikiChangelogEntry, seen: Set<string>): boolean =>
  seen.has(newsKey(e)) || seen.has(legacyNewsKey(e));

/** Coupons pas encore annoncés (la route ne sert que les codes actifs). */
export function newCoupons(coupons: WikiCoupon[], seen: Set<string>): WikiCoupon[] {
  return coupons.filter((c) => !seen.has(couponKey(c)));
}

/** Entrées du journal pas encore annoncées et récentes, la plus ancienne d'abord. */
export function newNews(
  entries: WikiChangelogEntry[],
  seen: Set<string>,
  today: string,
): WikiChangelogEntry[] {
  const oldest = shiftDays(today, -NEWS_MAX_AGE_DAYS);
  return entries
    .filter((e) => e.date >= oldest && !newsSeen(e, seen))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** `YYYY-MM-DD` décalé de `days` jours (UTC). */
export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Instant de la FIN d'un jour UTC, pour l'horodatage RELATIF de Discord
 * (`<t:…:R>`, « dans un mois »), juste dans tous les fuseaux. PAS pour la date
 * elle-même : `<t:…:D>` la convertit dans le fuseau du lecteur, et le 31/10 à
 * 23:59 UTC s'affichait « 1 novembre » à Paris ou à Séoul (constaté). La date
 * s'écrit donc en clair, comme sur le site.
 */
function endOfDayUnix(date: string): number {
  return Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000);
}

/**
 * « 1000000 » ou « 1 000 000 » (saisie du curé) → « 1,000,000 » ; une quantité
 * non numérique reste telle quelle.
 */
function formatQty(qty: string): string {
  const n = Number(qty.replace(/\s/g, ''));
  return Number.isFinite(n) ? n.toLocaleString('en-US') : qty;
}

/** Tronque au plafond d'un champ d'embed Discord. */
function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Embed d'un coupon. Lien du titre : la page que sert le site (`href`) ; sans
 * elle, pas de lien — c'est le cas de l'aperçu de `/coupon`, bâti depuis la
 * saisie du staff.
 */
export function couponEmbed(c: WikiCoupon, siteBaseUrl: string): APIEmbed {
  const until = endOfDayUnix(c.end);
  const rewards = c.rewards.map((r) => `• ${r.name} ×${formatQty(r.qty)}`);
  const url = joinUrl(siteBaseUrl, c.href);
  return {
    title: '🎟️ New coupon code',
    ...(url ? { url } : {}),
    color: 0xf5c518,
    description: clip(
      [
        `\`${c.code}\``,
        '',
        ...(rewards.length ? ['**Rewards**', ...rewards, ''] : []),
        `Valid until **${c.end}** (UTC) · ends <t:${until}:R>`,
      ].join('\n'),
      4096,
    ),
  };
}

/**
 * Bouton lien vers la page officielle d'échange, celle que sert le site
 * (`redeemUrl`) ; sans elle, pas de bouton. Pas de bouton « copier » : Discord
 * n'offre aucun accès au presse-papier, et l'astuce du message éphémère ne
 * contenant que le code a été jugée trop peu utile (Sevih, 25/09/2026).
 */
export function couponButtons(
  c: WikiCoupon,
): APIActionRowComponent<APIButtonComponent> | undefined {
  if (!c.redeemUrl) return undefined;
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: 'Redeem',
        emoji: { name: '🎁' },
        url: c.redeemUrl,
      },
    ],
  };
}

/** Libellé, emoji et couleur par type — mêmes emojis et teintes que la page /changelog. */
const NEWS_STYLE: Record<
  WikiChangelogEntry['type'],
  { label: string; icon: string; color: number }
> = {
  guide: { label: 'Guide', icon: '🧭', color: 0x10b981 },
  update: { label: 'Update', icon: '🔁', color: 0x0ea5e9 },
  feature: { label: 'Feature', icon: '🧰', color: 0x8b5cf6 },
  character: { label: 'Character', icon: '🛡️', color: 0xf59e0b },
  news: { label: 'News', icon: '📣', color: 0x14b8a6 },
  fix: { label: 'Fix', icon: '🐞', color: 0xf43f5e },
};

export function newsEmbed(
  e: WikiChangelogEntry,
  siteBaseUrl: string,
  imgBaseUrl: string,
): APIEmbed {
  const style = NEWS_STYLE[e.type] ?? NEWS_STYLE.news;
  return {
    author: { name: `${style.icon} ${style.label}` },
    title: clip(e.title, 256),
    url: `${siteBaseUrl}${e.href}`,
    color: style.color,
    description: clip(e.content.join('\n\n'), 4096),
    ...(e.thumb ? { thumbnail: { url: `${imgBaseUrl}${e.thumb}` } } : {}),
    footer: { text: 'Outerpedia' },
    timestamp: `${e.date}T00:00:00.000Z`,
  };
}
