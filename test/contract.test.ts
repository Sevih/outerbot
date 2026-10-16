/**
 * Contrat de l'API du site (`/api/bot/*`) : `test/fixtures/bot-api/*.json`
 * sont des extraits RÉELS de chaque route, recopiés du site. Ce test vérifie
 * (a) que chaque extrait a la forme des interfaces `Wiki*` du bot, (b) que les
 * vrais consommateurs tournent dessus sans produire de `undefined`, et (c) que
 * les copies sont égales aux extraits d'un checkout d'outerpedia, s'il y en a
 * un (`OUTERPEDIA_PATH`, sinon `../outerpedia`) — la CI n'en a pas, (c) s'y
 * saute en le disant.
 *
 * Rafraîchir après un changement du contrat : régénérer les extraits dans
 * outerpedia (commande en tête de son `src/lib/data/bot-api.contract.test.ts`),
 * puis les recopier ici :
 *
 *   cp ../outerpedia/src/lib/data/fixtures/bot-api/*.json test/fixtures/bot-api/
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    GUILD_ID: 'g1',
    DISCORD_TOKEN: 'jeton-de-test',
    CLIENT_ID: 'c1',
    ADMIN_USER_ID: 'a1',
    REVIEW_FORUM_ID: 'forum',
  });
});

import { couponButtons, couponEmbed, newsEmbed, newsKey } from '../src/announce/core.js';
import { charEmbed, charListLine, type CharBases } from '../src/commands/char.js';
import { itemEmbed } from '../src/commands/item.js';
import { welcomeMessage } from '../src/reviews/forum-sync.js';
import type {
  WikiChangelogEntry,
  WikiCharacter,
  WikiCoupon,
  WikiGuide,
  WikiItem,
} from '../src/wiki/client.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures/bot-api');
const ROUTES = ['characters', 'guides', 'items', 'coupons', 'changelog'] as const;

const read = (dir: string, route: string): unknown =>
  JSON.parse(readFileSync(join(dir, `${route}.json`), 'utf8'));

// --- (a) Gardes de forme, écrites à la main, une par interface `Wiki*` ------

type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const num: Check = (v) => typeof v === 'number';
const strArr: Check = (v) => Array.isArray(v) && v.every(str);
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const arrOf =
  (shape: Shape): Check =>
  (v) =>
    Array.isArray(v) && v.every((x) => shapeErrors(x, shape).length === 0);

/** Champ → [garde, obligatoire]. */
type Shape = Record<string, [Check, boolean]>;

/** Écarts d'un objet à sa forme (vide = conforme). Les champs en plus sont tolérés. */
function shapeErrors(v: unknown, shape: Shape): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['pas un objet'];
  const o = v as Record<string, unknown>;
  return Object.entries(shape).flatMap(([field, [check, required]]) => {
    if (!(field in o)) return required ? [`${field} absent`] : [];
    return check(o[field]) ? [] : [`${field} mal typé : ${JSON.stringify(o[field])}`];
  });
}

const SHAPES: Record<(typeof ROUTES)[number], Shape> = {
  characters: {
    slug: [str, true],
    name: [str, true],
    element: [str, true],
    class: [str, true],
    rarity: [num, true],
    id: [str, true],
    href: [str, false],
    icon: [str, false],
  } satisfies Record<keyof WikiCharacter, [Check, boolean]>,
  guides: {
    category: [str, true],
    slug: [str, true],
    title: [str, true],
    href: [str, false],
  } satisfies Record<keyof WikiGuide, [Check, boolean]>,
  items: {
    type: [oneOf('weapon', 'amulet', 'set', 'talisman', 'ee'), true],
    slug: [str, true],
    name: [str, true],
    icon: [str, true],
    classLimit: [str, false],
    effectName: [str, false],
    effectTiers: [strArr, false],
    source: [str, false],
    characterName: [str, false],
    href: [str, false],
  } satisfies Record<keyof WikiItem, [Check, boolean]>,
  coupons: {
    code: [str, true],
    start: [str, true],
    end: [str, true],
    rewards: [arrOf({ name: [str, true], qty: [str, true] }), true],
    href: [str, false],
    redeemUrl: [str, false],
  } satisfies Record<keyof WikiCoupon, [Check, boolean]>,
  changelog: {
    id: [str, false],
    date: [str, true],
    type: [oneOf('guide', 'update', 'feature', 'character', 'news', 'fix'), true],
    title: [str, true],
    content: [strArr, true],
    href: [str, true],
    thumb: [str, false],
  } satisfies Record<keyof WikiChangelogEntry, [Check, boolean]>,
};

describe('extraits du contrat : forme des interfaces Wiki*', () => {
  for (const route of ROUTES) {
    it(`${route}.json`, () => {
      const data = read(FIXTURES, route);
      expect(Array.isArray(data) && data.length > 0).toBe(true);
      const errors = (data as unknown[]).flatMap((x, i) =>
        shapeErrors(x, SHAPES[route]).map((e) => `[${i}] ${e}`),
      );
      expect(errors).toEqual([]);
    });
  }
});

// --- (b) Les consommateurs réels sur les extraits ---------------------------

const SITE = 'https://site.test';
const IMG = 'https://img.test';
const BASES: CharBases = { siteBaseUrl: SITE, imgBaseUrl: IMG, guildId: 'g1' };

const characters = read(FIXTURES, 'characters') as WikiCharacter[];
const items = read(FIXTURES, 'items') as WikiItem[];
const coupons = read(FIXTURES, 'coupons') as WikiCoupon[];
const changelog = read(FIXTURES, 'changelog') as WikiChangelogEntry[];

/** Tout ce qu'un rendu produit, en une chaîne : aucun `undefined` n'y a sa place. */
const flat = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

describe('extraits du contrat : les consommateurs les rendent', () => {
  it('journal : clé = id, embed lié à href', () => {
    for (const e of changelog) {
      expect(newsKey(e)).toBe(e.id);
      const embed = newsEmbed(e, SITE, IMG);
      expect(embed.url).toBe(`${SITE}${e.href}`);
      expect(flat(embed)).not.toContain('undefined');
    }
  });

  it('coupons : embed lié à href, bouton vers redeemUrl', () => {
    for (const c of coupons) {
      const embed = couponEmbed(c, SITE);
      expect(embed.url).toBe(`${SITE}${c.href}`);
      const buttons = couponButtons(c);
      const [redeem] = buttons?.components ?? [];
      expect(redeem && 'url' in redeem && redeem.url).toBe(c.redeemUrl);
      expect(flat(embed) + flat(buttons)).not.toContain('undefined');
    }
  });

  it('forum-sync : message d’accueil avec le lien de la fiche', () => {
    for (const c of characters) {
      const msg = welcomeMessage(c, SITE);
      expect(msg).toContain(`(${SITE}${c.href})`);
      expect(msg).not.toContain('undefined');
    }
  });

  it('/item : embed avec vignette et lien', () => {
    for (const i of items) {
      const embed = itemEmbed(i, SITE, IMG).toJSON();
      expect(embed.thumbnail?.url).toBe(`${IMG}${i.icon}`);
      expect(flat(embed)).toContain(`(${SITE}${i.href})`);
      expect(flat(embed)).not.toContain('undefined');
    }
  });

  it('/char : fiche (lien, vignette, fils de build) et ligne de liste', () => {
    const build = { threadId: 't1', infoThreadId: 't2' };
    for (const c of characters) {
      const embed = charEmbed(c, build, BASES).toJSON();
      expect(embed.thumbnail?.url).toBe(`${IMG}${c.icon}`);
      expect(flat(embed)).toContain(`(${SITE}${c.href})`);
      expect(embed.fields).toHaveLength(3);
      expect(flat(embed)).not.toContain('undefined');
      const line = charListLine(c, build, BASES);
      expect(line).toBe(
        `• [${c.name}](${SITE}${c.href}) ([💬](<https://discord.com/channels/g1/t1>))`,
      );
      expect(charListLine(c, undefined, BASES)).not.toContain('undefined');
    }
  });
});

describe('champ absent (site pas encore à jour) : lien omis, jamais reconstruit', () => {
  const [c] = characters;
  const bare: WikiCharacter = { ...c! };
  delete bare.href;
  delete bare.icon;

  it('/char : ni lien de fiche ni vignette, le nom de la liste sans lien', () => {
    const embed = charEmbed(bare, undefined, BASES).toJSON();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.fields ?? []).toEqual([]);
    expect(charListLine(bare, undefined, BASES)).toBe(`• ${bare.name}`);
  });

  it('forum-sync : pas de ligne de lien', () => {
    const msg = welcomeMessage(bare, SITE);
    expect(msg).not.toContain('View on Outerpedia');
    expect(msg).not.toContain('/characters/');
    expect(msg.endsWith('```')).toBe(true);
  });

  it('/item : pas de ligne de lien', () => {
    const item: WikiItem = { ...items[0]! };
    delete item.href;
    expect(flat(itemEmbed(item, SITE, IMG).toJSON())).not.toContain(SITE);
  });
});

// --- (c) Copies égales aux extraits du site ---------------------------------

const neighbour = resolve(ROOT, process.env.OUTERPEDIA_PATH ?? '../outerpedia');
const neighbourFixtures = join(neighbour, 'src/lib/data/fixtures/bot-api');
const hasNeighbour = existsSync(neighbourFixtures);

describe('extraits du contrat : copies à jour du site', () => {
  if (!hasNeighbour) {
    it.skip(`pas de checkout d'outerpedia (${neighbourFixtures}) : comparaison sautée`, () => {});
    return;
  }
  for (const route of ROUTES) {
    // JSON parsé, comparé en profondeur : chaque dépôt formate avec son prettier.
    it(`${route}.json égal à celui de ${neighbour}`, () => {
      expect(read(FIXTURES, route)).toEqual(read(neighbourFixtures, route));
    });
  }
});
