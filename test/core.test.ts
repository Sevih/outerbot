/**
 * Cœur pur des reviews — le CONTRAT utilisateur du forum (format X/5 et ses
 * tolérances, héritées du bot V2) et les règles de nettoyage. Si un de ces
 * tests casse, des messages valides du forum cessent d'être des reviews.
 */
import { describe, expect, it } from 'vitest';
import {
  parseReview,
  reviewGate,
  sanitizeReviewText,
  scoreFromReactions,
  type ReviewRules,
} from '../src/reviews/core.js';

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

describe('parseReview — ce que les joueurs tapent', () => {
  it('rien ne suit le 5 : « 4/50 » n’est pas une note sur 5', () => {
    expect(parseReview('4/50\nTrès bon.')).toBeNull();
    expect(parseReview('4/55\nTrès bon.')).toBeNull();
    expect(parseReview('4/5 !\nTrès bon.')?.rating).toBe(4);
    expect(parseReview('4/5 (PvE)\nTrès bon.')?.rating).toBe(4);
  });

  it('étoile avec sélecteur de variante U+FE0F (claviers mobiles)', () => {
    expect(parseReview('⭐\uFE0F 4/5\nTrès bon.')?.rating).toBe(4);
    expect(parseReview('⭐\uFE0F⭐\uFE0F 2/5\nBof.')?.rating).toBe(2);
  });

  it('virgule décimale', () => {
    expect(parseReview('4,5/5\nExcellent.')?.rating).toBe(4.5);
    expect(parseReview('⭐ 3,5 / 5\nCorrect.')?.rating).toBe(3.5);
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

  it('coupe par caractère : jamais une moitié d’emoji', () => {
    const cut = sanitizeReviewText(`${'x'.repeat(9)}😀😀`, 10);
    expect(cut).toBe(`${'x'.repeat(9)}😀`);
    expect(cut).not.toMatch(/[\uD800-\uDBFF]$/);
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

describe('reviewGate — âge de compte et rôle, en direct comme au resync', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 15);
  const old = now - 400 * DAY;
  const open: ReviewRules = { minAccountAgeDays: 30, allowedRoleIds: [] };
  const roles: ReviewRules = { minAccountAgeDays: 30, allowedRoleIds: ['r-review'] };

  it('compte trop récent : refusé', () => {
    const gate = reviewGate(now - 2 * DAY, ['r-review'], now, roles);
    expect(gate.allowed).toBe(false);
    expect(!gate.allowed && gate.reason).toContain('30 days');
    expect(reviewGate(now - 30 * DAY, null, now, open).allowed).toBe(true);
  });

  it('sans rôle requis : tout compte assez ancien, membre retrouvé ou non', () => {
    expect(reviewGate(old, [], now, open).allowed).toBe(true);
    expect(reviewGate(old, null, now, open).allowed).toBe(true);
  });

  it('rôle requis : il faut l’un d’eux', () => {
    expect(reviewGate(old, ['r-other', 'r-review'], now, roles).allowed).toBe(true);
    expect(reviewGate(old, ['r-other'], now, roles).allowed).toBe(false);
  });

  it('rôle requis et membre introuvable (parti du serveur) : refusé', () => {
    expect(reviewGate(old, null, now, roles).allowed).toBe(false);
  });

  it('âge minimal à 0 : la garde d’âge est coupée', () => {
    expect(reviewGate(now, [], now, { minAccountAgeDays: 0, allowedRoleIds: [] }).allowed).toBe(
      true,
    );
  });
});
