/**
 * Store SQLite — sur base mémoire : migrations, contrat de sortie (identique
 * V2), dédup par (slug, user), votes, resync atomique.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { Store, type NewReview } from '../src/db/store.js';

function review(over: Partial<NewReview> = {}): NewReview {
  return {
    messageId: 'm1',
    threadId: 't1',
    slug: 'dahlia',
    userId: 'u1',
    username: 'sevih',
    displayName: 'Sevih',
    avatar: 'abc',
    rating: 4,
    text: 'Très bon perso.',
    createdAt: '2026-07-21T10:00:00.000Z',
    ...over,
  };
}

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(openDb(':memory:'));
    store.registerThread('t1', 'dahlia');
  });

  it('threads : enregistrement, lookup, slugs connus', () => {
    expect(store.slugForThread('t1')).toBe('dahlia');
    expect(store.slugForThread('inconnu')).toBeUndefined();
    store.registerThread('t2', 'ame');
    expect(store.knownSlugs()).toEqual(new Set(['dahlia', 'ame']));
  });

  it('reviews : le contrat de sortie est celui de la V2 (champ à champ)', () => {
    store.addReview(review());
    expect(store.reviewsFor('dahlia')).toEqual([
      {
        id: 'm1',
        userId: 'u1',
        username: 'sevih',
        displayName: 'Sevih',
        avatar: 'abc',
        rating: 4,
        text: 'Très bon perso.',
        score: 0,
        source: 'evamains',
        timestamp: '2026-07-21T10:00:00.000Z',
      },
    ]);
  });

  it('dédup : une seule review par (perso, utilisateur) — contrainte DB', () => {
    store.addReview(review());
    expect(store.hasReview('dahlia', 'u1')).toBe(true);
    expect(() => store.addReview(review({ messageId: 'm2' }))).toThrow();
  });

  it('votes : delta appliqué ; tri score puis récence', () => {
    store.addReview(review({ messageId: 'm1', userId: 'u1', createdAt: '2026-07-01T00:00:00Z' }));
    store.addReview(review({ messageId: 'm2', userId: 'u2', createdAt: '2026-07-02T00:00:00Z' }));
    store.applyVote('m1', 1);
    store.applyVote('m1', 1);
    store.applyVote('m2', -1);
    const [first, second] = store.reviewsFor('dahlia');
    expect(first!.id).toBe('m1');
    expect(first!.score).toBe(2);
    expect(second!.score).toBe(-1);
  });

  it('suppression par message + summary agrégé arrondi au dixième', () => {
    store.addReview(review({ messageId: 'm1', userId: 'u1', rating: 4 }));
    store.addReview(review({ messageId: 'm2', userId: 'u2', rating: 5 }));
    store.addReview(review({ messageId: 'm3', userId: 'u3', rating: 3.5 }));
    expect(store.summary()).toEqual({ dahlia: { count: 3, average: 4.2 } });

    expect(store.removeReviewByMessage('m3')).toBe(true);
    expect(store.removeReviewByMessage('m3')).toBe(false);
    expect(store.summary()).toEqual({ dahlia: { count: 2, average: 4.5 } });
  });

  it('replaceAll : resync atomique — l’état final est exactement le scan', () => {
    store.addReview(review());
    store.replaceAll(
      [{ threadId: 't9', slug: 'ame' }],
      [review({ messageId: 'm9', threadId: 't9', slug: 'ame', userId: 'u9', score: 5 })],
    );
    expect(store.reviewsFor('dahlia')).toEqual([]);
    expect(store.slugForThread('t1')).toBeUndefined();
    expect(store.reviewsFor('ame')).toHaveLength(1);
    expect(store.reviewsFor('ame')[0]!.score).toBe(5);
  });

  it('builds curés : set/get/remove (ex-threads.json)', () => {
    store.setBuildThread('dahlia', '111', '222');
    expect(store.buildThread('dahlia')).toEqual({ threadId: '111', infoThreadId: '222' });
    store.setBuildThread('dahlia', '333');
    expect(store.buildThread('dahlia')).toEqual({ threadId: '333', infoThreadId: null });
    expect(store.removeBuildThread('dahlia')).toBe(true);
    expect(store.buildThread('dahlia')).toBeUndefined();
  });
});
