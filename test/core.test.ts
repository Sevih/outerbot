/**
 * Cœur pur des reviews — le CONTRAT utilisateur du forum (format X/5 et ses
 * tolérances, héritées du bot V2) et les règles de nettoyage. Si un de ces
 * tests casse, des messages valides du forum cessent d'être des reviews.
 */
import { describe, expect, it } from 'vitest';
import { parseReview, sanitizeReviewText, scoreFromReactions } from '../src/reviews/core.js';

describe('parseReview — le format X/5 et ses tolérances', () => {
  it('accepte le format nominal', () => {
    expect(parseReview('4/5\nTrès bon support, pilier de mes teams PvE.')).toEqual({
      rating: 4,
      text: 'Très bon support, pilier de mes teams PvE.',
    });
  });

  it('tolère décimales, étoiles décoratives et slash pleine chasse', () => {
    expect(parseReview('4.5/5\nExcellent.')?.rating).toBe(4.5);
    expect(parseReview('⭐ 3/5\nCorrect sans plus.')?.rating).toBe(3);
    expect(parseReview('★★ 2／5\nDéçu.')?.rating).toBe(2);
  });

  it('le texte multi-lignes est conservé', () => {
    const parsed = parseReview('5/5\nligne 1\nligne 2');
    expect(parsed?.text).toBe('ligne 1\nligne 2');
  });

  it('rejette : pas de note, note hors bornes, texte trop court ou absent', () => {
    expect(parseReview('Superbe perso, 10/10')).toBeNull(); // pas en 1re ligne au format /5
    expect(parseReview('0/5\nNul.')).toBeNull();
    expect(parseReview('6/5\nTrop bien ?')).toBeNull();
    expect(parseReview('4/5')).toBeNull(); // pas de texte
    expect(parseReview('4/5\nok')).toBeNull(); // < 3 caractères
    expect(parseReview('')).toBeNull();
  });
});

describe('sanitizeReviewText — rien d’exécutable ne passe, les emojis restent', () => {
  it('retire liens et mentions, garde les emojis custom', () => {
    const dirty = 'Voir https://spam.example <@123> <@!456> <@&789> @everyone @here <:pog:1234>';
    const clean = sanitizeReviewText(dirty, 1000);
    expect(clean).toContain('<:pog:1234>');
    expect(clean).not.toContain('http');
    expect(clean).not.toContain('@');
  });

  it('compacte les sauts de ligne et borne la longueur', () => {
    expect(sanitizeReviewText('a\n\n\n\nb', 1000)).toBe('a\n\nb');
    expect(sanitizeReviewText('x'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('scoreFromReactions — les réactions du bot ne comptent pas', () => {
  it('soustrait l’amorce du bot de chaque côté', () => {
    // Le bot pose 👍 et 👎 sur chaque review : 1/1 = personne n'a voté.
    expect(scoreFromReactions(1, 1)).toBe(0);
    expect(scoreFromReactions(4, 1)).toBe(3);
    expect(scoreFromReactions(1, 3)).toBe(-2);
  });

  it('ne passe jamais sous zéro par côté (réaction du bot retirée à la main)', () => {
    expect(scoreFromReactions(0, 0)).toBe(0);
    expect(scoreFromReactions(0, 2)).toBe(-1);
  });
});
