/**
 * Migration v3 (id du perso) sur une vraie base v2 écrite dans un dossier
 * temporaire : rien de perdu, remplissage des ids d'après la liste du site,
 * puis lecture `/reviews/<clé>` par id, par slug, et repli sur la colonne slug.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    GUILD_ID: 'g1',
    DISCORD_TOKEN: 'jeton-de-test',
    CLIENT_ID: 'c1',
    ADMIN_USER_ID: 'a1',
    REVIEW_FORUM_ID: 'forum',
  });
});

import { MIGRATIONS, openDb, type Db } from '../src/db/db.js';
import { Store } from '../src/db/store.js';
import { reviewsForKey } from '../src/http/server.js';
import type { WikiCharacter } from '../src/wiki/client.js';

const character = (id: string, slug: string): WikiCharacter => ({
  id,
  slug,
  name: slug,
  element: 'fire',
  class: 'striker',
  rarity: 3,
});
const CHARACTERS = [character('2000001', 'dahlia'), character('2000002', 'ame')];

let dir: string;
let path: string;

/** Une base v2 telle que la prod la porte : tout indexé par slug. */
function writeV2Base(): void {
  const v2 = new Database(path);
  v2.exec(MIGRATIONS[0]!);
  v2.exec(MIGRATIONS[1]!);
  v2.pragma('user_version = 2');
  v2.exec(`
    INSERT INTO threads (thread_id, slug) VALUES ('t1', 'dahlia'), ('t2', 'ame'), ('t3', 'ghost');
    INSERT INTO reviews (message_id, thread_id, slug, user_id, username, display_name, avatar,
                         rating, text, score, created_at)
    VALUES ('m1', 't1', 'dahlia', 'u1', 'u1', 'U1', NULL, 4, 'Bon.', 2, '2026-07-01T00:00:00Z'),
           ('m2', 't1', 'dahlia', 'u2', 'u2', 'U2', NULL, 5, 'Top.', 0, '2026-07-02T00:00:00Z'),
           ('m3', 't2', 'ame', 'u1', 'u1', 'U1', NULL, 3, 'Moyen.', 1, '2026-07-03T00:00:00Z'),
           ('m4', 't3', 'ghost', 'u1', 'u1', 'U1', NULL, 2, 'Bof.', 0, '2026-07-04T00:00:00Z');
    INSERT INTO build_threads (slug, thread_id, info_thread_id) VALUES ('dahlia', '111', '222');
    INSERT INTO meta (key, value) VALUES ('lastResync', '2026-07-21T00:00:00Z');
    INSERT INTO announcements (kind, key) VALUES ('coupon', 'CODE1');
  `);
  v2.close();
}

let db: Db;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'outerbot-migration-'));
  path = join(dir, 'outerbot.sqlite');
  writeV2Base();
  db = openDb(path);
  store = new Store(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration v2 → v3', () => {
  it('rien de perdu, ids encore vides', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(store.countThreads()).toBe(3);
    expect(store.countReviews()).toBe(4);
    expect(store.getMeta('lastResync')).toBe('2026-07-21T00:00:00Z');
    expect(store.announcedKeys('coupon')).toEqual(new Set(['CODE1']));
    expect(store.summary()).toEqual({
      dahlia: { count: 2, average: 4.5 },
      ame: { count: 1, average: 3 },
      ghost: { count: 1, average: 2 },
    });
    expect(store.knownCharacterIds()).toEqual(new Set());
    expect(store.unresolvedSlugs()).toEqual(['ame', 'dahlia', 'ghost']);
    // Les tables n'ont pas été reconstruites : la cascade d'un post vers ses reviews tient.
    expect(db.pragma('foreign_key_list(reviews)')).toHaveLength(1);
  });

  it('rouvrir une base v3 ne rejoue rien', () => {
    db.close();
    db = openDb(path);
    store = new Store(db);
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(store.countReviews()).toBe(4);
  });

  it('remplissage : reviews, posts et liens par id ; le slug inconnu est signalé', () => {
    expect(store.backfillCharacterIds(CHARACTERS)).toEqual(['ghost']);
    expect(store.reviewsFor('2000001').map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(store.reviewsFor('2000002').map((r) => r.id)).toEqual(['m3']);
    expect(store.knownCharacterIds()).toEqual(new Set(['2000001', '2000002']));
    expect(store.characterForThread('t1')).toEqual({ characterId: '2000001', slug: 'dahlia' });
    expect(store.characterForThread('t3')).toBeUndefined();
    expect(store.buildThread('2000001')).toEqual({ threadId: '111', infoThreadId: '222' });
    // Idempotent : un second passage ne change rien.
    expect(store.backfillCharacterIds(CHARACTERS)).toEqual(['ghost']);
    expect(store.countReviews()).toBe(4);
  });

  it('une ligne dont l’id entrerait en collision reste vide et signalée', () => {
    // Le perso 2000001 a déjà un post (rempli) ; un second post au slug « dahlia2 »
    // que la liste rattacherait au même id ne le vole pas.
    store.backfillCharacterIds(CHARACTERS);
    store.registerThread('t9', null, 'dahlia2');
    expect(store.backfillCharacterIds([character('2000001', 'dahlia2')])).toEqual([
      'dahlia2',
      'ghost',
    ]);
    expect(store.characterForThread('t1')).toEqual({ characterId: '2000001', slug: 'dahlia' });
  });
});

describe('/reviews/<clé>', () => {
  it('une clé de chiffres est un id', () => {
    store.backfillCharacterIds(CHARACTERS);
    expect(reviewsForKey(store, '2000001', CHARACTERS).map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(reviewsForKey(store, '9999999', CHARACTERS)).toEqual([]);
  });

  it('un slug se résout en id par la liste', () => {
    store.backfillCharacterIds(CHARACTERS);
    expect(reviewsForKey(store, 'ame', CHARACTERS).map((r) => r.id)).toEqual(['m3']);
  });

  it('repli sur la colonne slug : lignes pas encore remplies, site muet, slug inconnu', () => {
    // Pas encore rempli : le slug résolu ramène aussi ses lignes sans id.
    expect(reviewsForKey(store, 'dahlia', CHARACTERS).map((r) => r.id)).toEqual(['m1', 'm2']);
    // Pas de liste de persos (site injoignable depuis le démarrage).
    expect(reviewsForKey(store, 'ame', undefined).map((r) => r.id)).toEqual(['m3']);
    // Slug que la liste ne connaît pas.
    expect(reviewsForKey(store, 'ghost', CHARACTERS).map((r) => r.id)).toEqual(['m4']);
  });

  it('perso renommé : le nouveau slug rend les reviews posées sous l’ancien', () => {
    store.backfillCharacterIds(CHARACTERS);
    const renamed = [character('2000001', 'dahlia-prime'), character('2000002', 'ame')];
    expect(store.backfillCharacterIds(renamed)).toEqual(['ghost']);
    expect(reviewsForKey(store, 'dahlia-prime', renamed).map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(store.knownCharacterIds()).toEqual(new Set(['2000001', '2000002']));
    expect(store.buildThread('2000001')).toEqual({ threadId: '111', infoThreadId: '222' });
  });
});
