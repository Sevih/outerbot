/**
 * Variables d'environnement non textuelles : une valeur invalide fait échouer
 * le démarrage, en nommant la variable, au lieu de tourner avec NaN.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { positiveNumber, rolesWithoutGuild } from '../src/lib/env.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('positiveNumber', () => {
  it('absente ou vide : la valeur par défaut', () => {
    vi.stubEnv('OB_TEST_N', undefined);
    expect(positiveNumber('OB_TEST_N', 6)).toBe(6);
    vi.stubEnv('OB_TEST_N', '  ');
    expect(positiveNumber('OB_TEST_N', 6)).toBe(6);
  });

  it('nombre valide : lu tel quel (décimal accepté)', () => {
    vi.stubEnv('OB_TEST_N', '12');
    expect(positiveNumber('OB_TEST_N', 6)).toBe(12);
    vi.stubEnv('OB_TEST_N', '0.5');
    expect(positiveNumber('OB_TEST_N', 6)).toBe(0.5);
  });

  it('non numérique : le démarrage échoue en nommant la variable', () => {
    vi.stubEnv('OB_TEST_N', '6h');
    expect(() => positiveNumber('OB_TEST_N', 6)).toThrow(/OB_TEST_N="6h"/);
    vi.stubEnv('OB_TEST_N', 'Infinity');
    expect(() => positiveNumber('OB_TEST_N', 6)).toThrow(/OB_TEST_N/);
  });

  it('négatif : refusé ; zéro : refusé sauf allowZero', () => {
    vi.stubEnv('OB_TEST_N', '-1');
    expect(() => positiveNumber('OB_TEST_N', 6)).toThrow(/OB_TEST_N/);
    expect(() => positiveNumber('OB_TEST_N', 6, { allowZero: true })).toThrow(/OB_TEST_N/);
    vi.stubEnv('OB_TEST_N', '0');
    expect(() => positiveNumber('OB_TEST_N', 6)).toThrow(/OB_TEST_N/);
    expect(positiveNumber('OB_TEST_N', 30, { allowZero: true })).toBe(0);
  });
});

describe('rolesWithoutGuild', () => {
  const guild = '1264787916660670605';
  it('liste sans l’id du serveur : rendue telle quelle', () => {
    expect(rolesWithoutGuild('STAFF_ROLE_IDS', ['1', '2'], guild)).toEqual(['1', '2']);
    expect(rolesWithoutGuild('STAFF_ROLE_IDS', [], guild)).toEqual([]);
  });
  it('liste contenant l’id du serveur (@everyone) : le démarrage échoue', () => {
    expect(() => rolesWithoutGuild('STAFF_ROLE_IDS', ['1', guild], guild)).toThrow(
      /STAFF_ROLE_IDS.*GUILD_ID/,
    );
    expect(() => rolesWithoutGuild('REVIEW_ROLE_IDS', [guild], guild)).toThrow(/REVIEW_ROLE_IDS/);
  });
});
