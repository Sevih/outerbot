/**
 * Annonces — ce qui part dans le salon. Si un de ces tests casse, le bot
 * reposte de l'historique ou rate une nouveauté.
 */
import { describe, expect, it } from 'vitest';
import {
  couponButtons,
  couponEmbed,
  newCoupons,
  newNews,
  newsEmbed,
  newsKey,
  NEWS_MAX_AGE_DAYS,
} from '../src/announce/core.js';
import { openDb } from '../src/db/db.js';
import { Store } from '../src/db/store.js';
import type { WikiChangelogEntry, WikiCoupon } from '../src/wiki/client.js';

const coupon = (over: Partial<WikiCoupon> = {}): WikiCoupon => ({
  code: 'GOLDMOONPTY',
  start: '2026-09-23',
  end: '2026-10-31',
  rewards: [{ name: 'Gold', qty: '1000000' }],
  ...over,
});

const entry = (over: Partial<WikiChangelogEntry> = {}): WikiChangelogEntry => ({
  date: '2026-09-25',
  type: 'news',
  title: 'Outerpedia in French and Spanish',
  content: ['First **line**.', 'Second line.'],
  href: '/changelog',
  ...over,
});

describe('sélection des nouveautés', () => {
  it('coupons : seuls les codes jamais annoncés', () => {
    const list = [coupon(), coupon({ code: 'NEWCODE' })];
    expect(newCoupons(list, new Set(['GOLDMOONPTY'])).map((c) => c.code)).toEqual(['NEWCODE']);
  });

  it('journal : inconnues ET récentes, la plus ancienne d’abord', () => {
    const list = [
      entry({ date: '2026-09-25', title: 'B' }),
      entry({ date: '2026-09-24', title: 'A' }),
      entry({ date: '2026-09-25', title: 'Déjà vue' }),
      entry({ date: '2026-09-01', title: 'Vieille, titre corrigé' }),
    ];
    const seen = new Set([newsKey(list[2]!)]);
    expect(newNews(list, seen, '2026-09-25').map((e) => e.title)).toEqual(['A', 'B']);
  });

  it(`journal : la borne d'ancienneté est de ${NEWS_MAX_AGE_DAYS} jours, bornes incluses`, () => {
    const list = [entry({ date: '2026-09-23', title: 'limite' }), entry({ date: '2026-09-22' })];
    expect(newNews(list, new Set(), '2026-09-25').map((e) => e.title)).toEqual(['limite']);
  });
});

describe('embeds', () => {
  it('coupon : code copiable, quantités lisibles, fin de validité en clair', () => {
    const e = couponEmbed(coupon(), 'https://outerpedia.com');
    expect(e.url).toBe('https://outerpedia.com/coupons');
    expect(e.description).toContain('`GOLDMOONPTY`');
    expect(e.description).toContain('• Gold ×1,000,000');
    const spaced = couponEmbed(coupon({ rewards: [{ name: 'Gold', qty: '1 000 000' }] }), '');
    expect(spaced.description).toContain('• Gold ×1,000,000');
    // Date EN CLAIR (un horodatage `:D` la décalerait selon le fuseau du
    // lecteur), plus un relatif, juste partout.
    const end = Date.parse('2026-10-31T23:59:59Z') / 1000;
    expect(e.description).toContain('Valid until **2026-10-31** (UTC)');
    expect(e.description).toContain(`<t:${end}:R>`);
    expect(e.description).not.toContain(':D>');
  });

  it('coupon : un seul bouton, Redeem, vers la page officielle', () => {
    const buttons = couponButtons().components;
    expect(buttons).toHaveLength(1);
    const [redeem] = buttons;
    expect(redeem && 'url' in redeem && redeem.url).toMatch(/^https:\/\/coupon\.outerplane/);
  });

  it('journal : lien du site, vignette sur le CDN, date en horodatage', () => {
    const e = newsEmbed(
      entry({ href: '/characters/titia', thumb: '/images/x.png', type: 'character' }),
      'https://outerpedia.com',
      'https://img.outerpedia.com',
    );
    expect(e.url).toBe('https://outerpedia.com/characters/titia');
    expect(e.thumbnail?.url).toBe('https://img.outerpedia.com/images/x.png');
    expect(e.author?.name).toContain('Character');
    expect(e.description).toBe('First **line**.\n\nSecond line.');
    expect(e.timestamp).toBe('2026-09-25T00:00:00.000Z');
  });

  it('journal : pas de vignette sans image', () => {
    expect(newsEmbed(entry(), 'a', 'b').thumbnail).toBeUndefined();
  });
});

describe('Store — annonces', () => {
  it('marquage idempotent, séparé par type', () => {
    const store = new Store(openDb(':memory:'));
    store.markAnnounced('coupon', ['A', 'B']);
    store.markAnnounced('coupon', ['A']);
    store.markAnnounced('news', ['A']);
    expect(store.announcedKeys('coupon')).toEqual(new Set(['A', 'B']));
    expect(store.announcedKeys('news')).toEqual(new Set(['A']));
  });
});
