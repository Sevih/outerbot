/**
 * Store SQLite — sur base mémoire : migrations, contrat de sortie (identique
 * V2), dédup par (perso, user), votes, resync atomique, remplissage des ids.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { Store, type NewReview } from '../src/db/store.js';

function review(over: Partial<NewReview> = {}): NewReview {
  return {
    messageId: 'm1',
    threadId: 't1',
    characterId: '1',
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
    store.registerThread('t1', '1', 'dahlia');
  });

  it('threads : enregistrement, lookup, ids connus', () => {
    expect(store.characterForThread('t1')).toEqual({ characterId: '1', slug: 'dahlia' });
    expect(store.characterForThread('inconnu')).toBeUndefined();
    store.registerThread('t2', '2', 'ame');
    expect(store.knownCharacterIds()).toEqual(new Set(['1', '2']));
    expect(store.countThreads()).toBe(2);
  });

  it('reviews : le contrat de sortie est celui de la V2 (champ à champ)', () => {
    store.addReview(review());
    expect(store.reviewsFor('1')).toEqual([
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

  it('dédup : une seule review par (perso, utilisateur) — contrainte DB, par id', () => {
    store.addReview(review());
    expect(store.hasReview('1', 'u1')).toBe(true);
    expect(store.hasReview('1', 'u2')).toBe(false);
    // Même perso sous un autre slug (renommé) : refusé par l'id.
    expect(() => store.addReview(review({ messageId: 'm2', slug: 'dahlia-renamed' }))).toThrow(
      /character_id/,
    );
  });

  it('votes : delta appliqué ; tri score puis récence', () => {
    store.addReview(review({ messageId: 'm1', userId: 'u1', createdAt: '2026-07-01T00:00:00Z' }));
    store.addReview(review({ messageId: 'm2', userId: 'u2', createdAt: '2026-07-02T00:00:00Z' }));
    store.applyVote('m1', 1);
    store.applyVote('m1', 1);
    store.applyVote('m2', -1);
    const [first, second] = store.reviewsFor('1');
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

  it('purge : chaque message purgé sort, les autres restent', () => {
    store.addReview(review({ messageId: 'm1', userId: 'u1' }));
    store.addReview(review({ messageId: 'm2', userId: 'u2' }));
    store.addReview(review({ messageId: 'm3', userId: 'u3' }));
    expect(store.removeReviewsByMessages(['m1', 'm3', 'pas-une-review'])).toBe(2);
    expect(store.reviewsFor('1').map((r) => r.id)).toEqual(['m2']);
  });

  it('édition : note et texte remplacés, score et date gardés', () => {
    store.addReview(review({ score: 3 }));
    expect(store.updateReviewContent('m1', 2.5, 'Moins bien qu’annoncé.')).toBe(true);
    expect(store.reviewsFor('1')[0]).toMatchObject({
      rating: 2.5,
      text: 'Moins bien qu’annoncé.',
      score: 3,
      timestamp: '2026-07-21T10:00:00.000Z',
    });
    expect(store.updateReviewContent('inconnu', 4, 'Rien.')).toBe(false);
  });

  it('setScore : score posé tel quel, sans effet hors review', () => {
    store.addReview(review({ score: 4 }));
    expect(store.setScore('m1', 0)).toBe(true);
    expect(store.reviewsFor('1')[0]!.score).toBe(0);
    expect(store.setScore('inconnu', 2)).toBe(false);
  });

  it('post supprimé : le fil et ses reviews sortent, le slug redevient sans post', () => {
    store.registerThread('t2', '2', 'ame');
    store.addReview(review({ messageId: 'm1', userId: 'u1' }));
    store.addReview(review({ messageId: 'm2', userId: 'u2' }));
    store.addReview(
      review({ messageId: 'm3', threadId: 't2', characterId: '2', slug: 'ame', userId: 'u1' }),
    );
    expect(store.removeThread('t1')).toBe(true);
    expect(store.reviewsFor('1')).toEqual([]);
    expect(store.knownCharacterIds()).toEqual(new Set(['2']));
    expect(store.reviewsFor('2')).toHaveLength(1);
    expect(store.removeThread('t1')).toBe(false);
  });

  it('replaceAll : resync atomique — l’état final est exactement le scan', () => {
    store.addReview(review());
    store.replaceAll(
      [{ threadId: 't9', characterId: '2', slug: 'ame' }],
      [
        review({
          messageId: 'm9',
          threadId: 't9',
          characterId: '2',
          slug: 'ame',
          userId: 'u9',
          score: 5,
        }),
      ],
    );
    expect(store.reviewsFor('1')).toEqual([]);
    expect(store.characterForThread('t1')).toBeUndefined();
    expect(store.reviewsFor('2')).toHaveLength(1);
    expect(store.reviewsFor('2')[0]!.score).toBe(5);
  });

  it('post connu sans id : ligne rendue telle quelle, review gardée par slug puis remplie', () => {
    store.registerThread('t3', null, 'ghost');
    expect(store.threadOf('t3')).toEqual({ characterId: null, slug: 'ghost' });
    expect(store.threadOf('inconnu')).toBeUndefined();

    store.addReview(review({ messageId: 'm3', threadId: 't3', characterId: null, slug: 'ghost' }));
    expect(store.hasReviewBySlug('ghost', 'u1')).toBe(true);
    expect(store.hasReviewBySlug('ghost', 'u2')).toBe(false);

    store.backfillCharacterIds([{ id: '2000009', slug: 'ghost' }]);
    expect(store.reviewsFor('2000009').map((r) => r.id)).toEqual(['m3']);
    expect(store.hasReview('2000009', 'u1')).toBe(true);
  });

  it('builds curés : set/get/remove (ex-threads.json)', () => {
    store.setBuildThread('1', 'dahlia', '111', '222');
    expect(store.buildThread('1')).toEqual({ threadId: '111', infoThreadId: '222' });
    // Même id, slug renommé : la ligne est mise à jour, pas doublée.
    store.setBuildThread('1', 'dahlia-renamed', '333');
    expect(store.buildThread('1')).toEqual({ threadId: '333', infoThreadId: null });
    expect(store.removeBuildThread('1')).toBe(true);
    expect(store.buildThread('1')).toBeUndefined();
  });
});
