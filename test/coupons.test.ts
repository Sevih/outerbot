/**
 * /coupon — droits, dates, récompenses, suggestions, et la définition de la
 * commande elle-même (Discord la refuse au déploiement si elle est mal formée).
 */
import { describe, expect, it } from 'vitest';
import {
  canManageCoupons,
  codeChoices,
  dateChoices,
  findCoupon,
  isDate,
  isValidCode,
  normalizeCode,
  popularRewards,
  rewardsFromInputs,
  toAnnouncement,
  toRaw,
} from '../src/coupons/core.js';
import type { LiveCoupon } from '../src/coupons/client.js';

const live = (over: Partial<LiveCoupon> = {}): LiveCoupon => ({
  code: 'GOLDMOONPTY',
  start: '2026-09-23',
  end: '2026-10-31',
  rewards: [{ id: 'SYS_ASSET_GOLD', name: 'Gold', qty: '1000000' }],
  ...over,
});

describe('droits', () => {
  const staff = ['r-staff', 'r-mod'];
  it('admin toujours, staff par rôle, personne d’autre', () => {
    expect(canManageCoupons('admin', [], staff, 'admin')).toBe(true);
    expect(canManageCoupons('u', ['r-other', 'r-mod'], staff, 'admin')).toBe(true);
    expect(canManageCoupons('u', ['r-other'], staff, 'admin')).toBe(false);
  });
  it('aucun rôle configuré = admin seul, jamais tout le monde', () => {
    expect(canManageCoupons('u', ['r-any'], [], 'admin')).toBe(false);
  });
});

describe('dates', () => {
  it('format ET date réelle', () => {
    expect(isDate('2026-10-31')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('31/10/2026')).toBe(false);
  });
  it('suggestions : saisie valide d’abord, puis échéances filtrées sur la saisie', () => {
    expect(dateChoices('', '2026-09-25').map((c) => c.value)).toEqual([
      '2026-09-25',
      '2026-09-26',
      '2026-10-02',
      '2026-10-09',
      '2026-10-25',
    ]);
    expect(dateChoices('2026-10', '2026-09-25').map((c) => c.value)).toEqual([
      '2026-10-02',
      '2026-10-09',
      '2026-10-25',
    ]);
    expect(dateChoices('2026-12-31', '2026-09-25')[0]).toEqual({
      name: '2026-12-31',
      value: '2026-12-31',
    });
  });
});

describe('récompenses', () => {
  it('paires → description ; les trous sont ignorés', () => {
    expect(
      rewardsFromInputs([
        { id: 'SYS_ASSET_GOLD', qty: 1000 },
        { id: null, qty: null },
        { id: 'TI_Item_Stamina', qty: 200 },
      ]),
    ).toEqual({ ok: true, description: { SYS_ASSET_GOLD: '1000', TI_Item_Stamina: '200' } });
  });
  it('refuse une récompense sans quantité, une quantité seule, un doublon', () => {
    expect(rewardsFromInputs([{ id: 'A', qty: null }]).ok).toBe(false);
    expect(rewardsFromInputs([{ id: null, qty: 5 }]).ok).toBe(false);
    expect(
      rewardsFromInputs([
        { id: 'A', qty: 1 },
        { id: 'A', qty: 2 },
      ]).ok,
    ).toBe(false);
  });
  it('les plus fréquentes d’abord (proposées avant toute saisie)', () => {
    const list = [
      live({ rewards: [{ id: 'G', name: 'Gold', qty: '1' }] }),
      live({
        rewards: [
          { id: 'G', name: 'Gold', qty: '1' },
          { id: 'E', name: 'Ether', qty: '1' },
        ],
      }),
    ];
    expect(popularRewards(list).map((r) => r.id)).toEqual(['G', 'E']);
  });
});

describe('codes existants', () => {
  it('actifs d’abord (récents en tête), expirés ensuite, filtrés sur la saisie', () => {
    const list = [
      live({ code: 'OLD', start: '2025-01-01', end: '2025-02-01' }),
      live({ code: 'NOW', start: '2026-09-01', end: '2026-10-01' }),
      live({ code: 'NEWER', start: '2026-09-20', end: '2026-10-20' }),
    ];
    expect(codeChoices(list, '', '2026-09-25').map((c) => c.value)).toEqual([
      'NEWER',
      'NOW',
      'OLD',
    ]);
    expect(codeChoices(list, 'ne', '2026-09-25').map((c) => c.value)).toEqual(['NEWER']);
    expect(codeChoices(list, '', '2026-09-25')[2]?.name).toContain('expired');
  });

  it('edit/remove retrouvent un code tapé en minuscules ou avec des blancs', () => {
    const list = [live({ code: 'GOLDMOONPTY' }), live({ code: '24KTHANKYOU' })];
    expect(findCoupon(list, 'goldmoonpty')?.code).toBe('GOLDMOONPTY');
    expect(findCoupon(list, '  24kThankYou ')?.code).toBe('24KTHANKYOU');
    expect(findCoupon(list, 'NOPE')).toBeUndefined();
  });
});

describe('forme d’un code', () => {
  it('majuscules, sans blancs autour', () => {
    expect(normalizeCode('  goldMoon26 ')).toBe('GOLDMOON26');
  });
  it('4 à 32 lettres ou chiffres', () => {
    expect(isValidCode('GOLDMOONPTY')).toBe(true);
    expect(isValidCode('24KTHANKYOU')).toBe(true);
    expect(isValidCode('ABCD')).toBe(true);
    expect(isValidCode('A'.repeat(32))).toBe(true);
    expect(isValidCode('ABC')).toBe(false);
    expect(isValidCode('A'.repeat(33))).toBe(false);
  });
  it('refuse tout autre caractère : backtick, espace, crochet, lien', () => {
    expect(isValidCode('GIFT`X')).toBe(false);
    expect(isValidCode('GIFT CODE')).toBe(false);
    expect(isValidCode('[GIFT]')).toBe(false);
    expect(isValidCode(normalizeCode('gift` [claim](https://x.example) `x'))).toBe(false);
    expect(isValidCode('CODE-2026')).toBe(false);
    expect(isValidCode('CODÉ2026')).toBe(false);
  });
  it('se juge après majuscules : un code minuscule valide passe', () => {
    expect(isValidCode('goldmoon')).toBe(false);
    expect(isValidCode(normalizeCode('goldmoon'))).toBe(true);
  });
});

describe('conversions', () => {
  it('liste vivante → stocké → annonce, sans perte', () => {
    const raw = toRaw(live());
    expect(raw.description).toEqual({ SYS_ASSET_GOLD: '1000000' });
    expect(toAnnouncement(raw, new Map([['SYS_ASSET_GOLD', 'Gold']])).rewards).toEqual([
      { name: 'Gold', qty: '1000000' },
    ]);
  });
});

describe('définition de /coupon', () => {
  it('se sérialise, et chaque option requise précède les facultatives', async () => {
    Object.assign(process.env, {
      DISCORD_TOKEN: 't',
      CLIENT_ID: '1',
      GUILD_ID: '1',
      ADMIN_USER_ID: '1',
      REVIEW_FORUM_ID: '1',
    });
    const { couponCommand } = await import('../src/commands/coupon.js');
    const json = couponCommand.data.toJSON();
    const subs = json.options ?? [];
    expect(subs.map((s) => s.name)).toEqual(['add', 'edit', 'remove']);
    // L'ordre affiché par Discord : les champs de base d'abord.
    const add = subs[0];
    const addNames = (add && 'options' in add ? add.options : undefined)?.map((o) => o.name);
    expect(addNames?.slice(0, 5)).toEqual(['code', 'start', 'end', 'reward1', 'qty1']);
    // Requis EXACTEMENT : code, dates et UNE récompense. Les paires 2 à 5 sont
    // facultatives (toutes requises, Discord en exigeait 5).
    const required = (sub: (typeof subs)[number] | undefined) =>
      (sub && 'options' in sub ? sub.options : undefined)
        ?.filter((o) => o.required)
        .map((o) => o.name);
    expect(required(add)).toEqual(['code', 'start', 'end', 'reward1', 'qty1']);
    expect(required(subs[1])).toEqual(['code']);
    expect(required(subs[2])).toEqual(['code']);
    for (const sub of subs) {
      const opts = ('options' in sub ? sub.options : undefined) ?? [];
      expect(opts.length).toBeLessThanOrEqual(25);
      const firstOptional = opts.findIndex((o) => !o.required);
      if (firstOptional >= 0)
        expect(opts.slice(firstOptional).every((o) => !o.required)).toBe(true);
    }
  });
});
