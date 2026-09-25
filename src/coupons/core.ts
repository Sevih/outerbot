/**
 * /coupon — cœur PUR : droits, dates, récompenses, suggestions d'autocomplétion.
 * Aucun accès Discord ni réseau (testé tel quel, cf. test/coupons.test.ts).
 * La validation qui fait foi reste celle du site ; ici, on attrape tôt ce qui
 * se corrige dans la même commande.
 */
import { shiftDays } from '../announce/core.js';
import type { WikiCoupon } from '../wiki/client.js';
import type { LiveCoupon, RawCoupon, RewardChoice } from './client.js';

/** Nombre de paires récompense/quantité proposées par la commande. */
export const MAX_REWARDS = 5;

/** Plafonds Discord d'une autocomplétion. */
const MAX_CHOICES = 25;
const MAX_CHOICE_NAME = 100;

export interface Choice {
  name: string;
  value: string;
}

/**
 * Droit d'utiliser /coupon : l'admin du bot, ou un des rôles staff. Sans rôle
 * configuré, personne d'autre que l'admin — jamais « tout le monde ».
 */
export function canManageCoupons(
  userId: string,
  memberRoleIds: readonly string[],
  staffRoleIds: readonly string[],
  adminUserId: string,
): boolean {
  return userId === adminUserId || memberRoleIds.some((r) => staffRoleIds.includes(r));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` ET date réelle (pas de 2026-02-30). */
export function isDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * Suggestions de date : la saisie si elle est valide, puis aujourd'hui et
 * quelques échéances courantes. Discord laisse de toute façon taper librement.
 */
export function dateChoices(typed: string, today: string): Choice[] {
  const presets: [number, string][] = [
    [0, 'today'],
    [1, 'tomorrow'],
    [7, 'in 1 week'],
    [14, 'in 2 weeks'],
    [30, 'in 30 days'],
  ];
  const out: Choice[] = [];
  const t = typed.trim();
  if (isDate(t)) out.push({ name: t, value: t });
  for (const [days, label] of presets) {
    const d = shiftDays(today, days);
    if (d !== t && d.startsWith(t)) out.push({ name: `${d} (${label})`, value: d });
  }
  return out.slice(0, MAX_CHOICES);
}

/**
 * Codes existants pour edit/remove : actifs et à venir d'abord (les plus
 * récents en tête), expirés ensuite ; filtrés sur la saisie.
 */
export function codeChoices(list: LiveCoupon[], typed: string, today: string): Choice[] {
  const q = typed.trim().toLowerCase();
  const live = (c: LiveCoupon) => c.end >= today;
  return list
    .filter((c) => c.code.toLowerCase().includes(q))
    .sort((a, b) => Number(live(b)) - Number(live(a)) || b.start.localeCompare(a.start))
    .slice(0, MAX_CHOICES)
    .map((c) => ({
      name: `${c.code} · ${live(c) ? 'ends' : 'expired'} ${c.end}`.slice(0, MAX_CHOICE_NAME),
      value: c.code,
    }));
}

/**
 * Récompenses les plus fréquentes de la liste — proposées tant que rien n'est
 * tapé (Gold, Ether… reviennent dans presque tous les codes).
 */
export function popularRewards(list: LiveCoupon[], limit = MAX_CHOICES): RewardChoice[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const c of list)
    for (const r of c.rewards) {
      const e = count.get(r.id) ?? { name: r.name, n: 0 };
      e.n++;
      count.set(r.id, e);
    }
  return [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([id, e]) => ({ id, name: e.name }));
}

export const rewardChoices = (rewards: RewardChoice[]): Choice[] =>
  rewards
    .slice(0, MAX_CHOICES)
    .map((r) => ({ name: r.name.slice(0, MAX_CHOICE_NAME), value: r.id }));

/** Une paire lue dans les options `rewardN` / `qtyN`. */
export interface RewardInput {
  id: string | null;
  qty: number | null;
}

/**
 * Paires → `{ id: quantité }`. Une récompense sans quantité (ou l'inverse) est
 * une erreur, pas un défaut silencieux ; une même récompense deux fois aussi.
 */
export function rewardsFromInputs(
  inputs: RewardInput[],
): { ok: true; description: Record<string, string> } | { ok: false; error: string } {
  const description: Record<string, string> = {};
  for (const [i, { id, qty }] of inputs.entries()) {
    const n = i + 1;
    if (!id && qty === null) continue;
    if (!id) return { ok: false, error: `qty${n} is set but reward${n} is empty.` };
    if (qty === null) return { ok: false, error: `reward${n} needs a quantity (qty${n}).` };
    if (id in description) return { ok: false, error: `reward${n} is listed twice.` };
    description[id] = String(qty);
  }
  return { ok: true, description };
}

/** Coupon stocké → forme de l'annonce (aperçu identique au message final). */
export function toAnnouncement(c: RawCoupon, names: Map<string, string | null>): WikiCoupon {
  return {
    code: c.code,
    start: c.start,
    end: c.end,
    rewards: Object.entries(c.description).map(([id, qty]) => ({
      name: names.get(id) ?? id,
      qty,
    })),
  };
}

/** Coupon de la liste vivante → format stocké (base d'un edit). */
export const toRaw = (c: LiveCoupon): RawCoupon => ({
  code: c.code,
  start: c.start,
  end: c.end,
  description: Object.fromEntries(c.rewards.map((r) => [r.id, r.qty])),
});
