/**
 * Changements Discord sur une review déjà déposée (édition, réaction vidée) :
 * l'index reste ce qu'un resync reconstruirait.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { Store } from '../src/db/store.js';
import { applyEdit, rescoreFromReactions } from '../src/reviews/index-events.js';

let store: Store;

beforeEach(() => {
  store = new Store(openDb(':memory:'));
  store.registerThread('t1', '1', 'dahlia');
  store.addReview({
    messageId: 'm1',
    threadId: 't1',
    characterId: '1',
    slug: 'dahlia',
    userId: 'u1',
    username: 'sevih',
    displayName: 'Sevih',
    avatar: null,
    rating: 4,
    text: 'Très bon perso.',
    score: 2,
    createdAt: '2026-07-21T10:00:00.000Z',
  });
});

describe('applyEdit', () => {
  it('review restée au format : nouvelle note et nouveau texte, score gardé', () => {
    expect(applyEdit(store, 'm1', '2/5\nFinalement moyen.', 1000)).toBe('updated');
    expect(store.reviewsFor('1')[0]).toMatchObject({
      rating: 2,
      text: 'Finalement moyen.',
      score: 2,
    });
  });

  it('le texte édité est nettoyé comme au dépôt (liens retirés, borne)', () => {
    expect(applyEdit(store, 'm1', '3/5\nVoir https://exemple.org ici', 1000)).toBe('updated');
    expect(store.reviewsFor('1')[0]!.text).toBe('Voir  ici');
    applyEdit(store, 'm1', '3/5\n' + 'a'.repeat(50), 10);
    expect(store.reviewsFor('1')[0]!.text).toBe('a'.repeat(10));
  });

  it('review qui perd le format X/5 : retirée de l’index', () => {
    expect(applyEdit(store, 'm1', 'Je retire ma note.', 1000)).toBe('removed');
    expect(store.reviewsFor('1')).toEqual([]);
  });

  it('texte vide après nettoyage : retirée aussi', () => {
    expect(applyEdit(store, 'm1', '4/5\nhttps://exemple.org/x', 1000)).toBe('removed');
    expect(store.countReviews()).toBe(0);
  });

  it('message qui n’est pas une review : rien ne change, même mis au format', () => {
    expect(applyEdit(store, 'autre', '5/5\nSuper perso.', 1000)).toBe('not_a_review');
    expect(applyEdit(store, 'autre', 'bonjour', 1000)).toBe('not_a_review');
    expect(store.countReviews()).toBe(1);
  });
});

describe('rescoreFromReactions', () => {
  const reactions = (entries: [string, { count: number; me: boolean }][]) => new Map(entries);

  it('une réaction vidée : seul ce qui reste compte, sans le bot', () => {
    // 👎 vidé par un modérateur ; 👍 garde l'amorce du bot et 3 votes.
    expect(rescoreFromReactions(store, 'm1', reactions([['👍', { count: 4, me: true }]]))).toBe(
      true,
    );
    expect(store.reviewsFor('1')[0]!.score).toBe(3);

    rescoreFromReactions(store, 'm1', reactions([['👎', { count: 2, me: false }]]));
    expect(store.reviewsFor('1')[0]!.score).toBe(-2);
  });

  it('message hors index : aucun effet', () => {
    expect(rescoreFromReactions(store, 'autre', reactions([]))).toBe(false);
  });
});
