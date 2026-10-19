/**
 * Dépôt d'une review depuis un message du forum (`tryAddReview`) : post rempli
 * (par id), post connu sans id (gardée par slug), thread absent, doublon.
 */
import type { Message } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    GUILD_ID: 'g1',
    DISCORD_TOKEN: 'jeton-de-test',
    CLIENT_ID: 'c1',
    ADMIN_USER_ID: 'a1',
    REVIEW_FORUM_ID: 'forum',
  });
});

import { openDb } from '../src/db/db.js';
import { Store } from '../src/db/store.js';
import { tryAddReview } from '../src/reviews/listener.js';

/** Message factice : les seuls champs que `tryAddReview` lit. */
function message(over: { id?: string; channelId: string; content?: string; userId?: string }) {
  const userId = over.userId ?? 'u1';
  return {
    id: over.id ?? 'm1',
    channelId: over.channelId,
    content: over.content ?? '4/5\nTrès bon perso.',
    author: { id: userId, username: userId, displayName: userId, avatar: null, bot: false },
    member: null,
    createdAt: new Date('2026-10-19T10:00:00.000Z'),
  } as unknown as Message;
}

let store: Store;

beforeEach(() => {
  store = new Store(openDb(':memory:'));
  store.registerThread('t1', '1', 'dahlia');
  store.registerThread('t3', null, 'ghost');
});

describe('tryAddReview', () => {
  it('post rempli : review déposée par id (chemin inchangé)', () => {
    expect(tryAddReview(store, message({ channelId: 't1' }))).toBeNull();
    expect(store.reviewsFor('1')).toMatchObject([{ id: 'm1', userId: 'u1', rating: 4 }]);
    expect(store.hasReview('1', 'u1')).toBe(true);
  });

  it('post connu sans id : review gardée par slug, servie par slug', () => {
    expect(tryAddReview(store, message({ channelId: 't3' }))).toBeNull();
    expect(store.reviewsFor('x', 'ghost').map((r) => r.id)).toEqual(['m1']);
    expect(store.reviewsForSlug('ghost').map((r) => r.id)).toEqual(['m1']);
    expect(store.unresolvedSlugs()).toEqual(['ghost']);
  });

  it('post connu sans id : même auteur une seconde fois → doublon', () => {
    expect(tryAddReview(store, message({ channelId: 't3' }))).toBeNull();
    expect(tryAddReview(store, message({ id: 'm2', channelId: 't3' }))).toBe('duplicate');
    expect(tryAddReview(store, message({ id: 'm3', channelId: 't3', userId: 'u2' }))).toBeNull();
    expect(store.reviewsForSlug('ghost')).toHaveLength(2);
  });

  it('post rempli : même auteur une seconde fois → doublon', () => {
    expect(tryAddReview(store, message({ channelId: 't1' }))).toBeNull();
    expect(tryAddReview(store, message({ id: 'm2', channelId: 't1' }))).toBe('duplicate');
  });

  it('thread absent de la base : ignoré', () => {
    expect(tryAddReview(store, message({ channelId: 't9' }))).toBe('unknown_thread');
    expect(store.countReviews()).toBe(0);
  });

  it('post connu sans id, mauvais format : refusé avant l’écriture', () => {
    expect(tryAddReview(store, message({ channelId: 't3', content: 'super perso' }))).toBe(
      'bad_format',
    );
    expect(store.countReviews()).toBe(0);
  });
});
