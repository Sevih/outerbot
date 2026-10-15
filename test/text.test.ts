/**
 * fitLines — la liste de /char tient dans un message Discord (2000 caractères),
 * en-tête compris, sans couper une ligne (donc jamais un lien) au milieu.
 */
import { describe, expect, it } from 'vitest';
import { fitLines } from '../src/lib/text.js';

/** Ligne réelle de /char : lien du perso + lien du fil de build (ids à 19 chiffres). */
const line = (i: number): string =>
  `• [Character Number ${i}](https://outerpedia.com/characters/character-number-${i})` +
  ` ([💬](<https://discord.com/channels/1264787916660670605/13${String(i).padStart(17, '0')}>))`;

describe('fitLines', () => {
  it('tout tient : en-tête puis toutes les lignes, rien d’autre', () => {
    const lines = [line(1), line(2)];
    expect(fitLines('👥 **Characters (2)**', lines)).toBe(
      `👥 **Characters (2)**\n${lines.join('\n')}`,
    );
  });

  it('32 persos avec un fil chacun : ≤ 2000, lignes entières, « … and N more »', () => {
    const lines = Array.from({ length: 32 }, (_, i) => line(i + 1));
    const header = '👥 **Characters (32)**';
    expect([header, ...lines].join('\n').length).toBeGreaterThan(2000);

    const out = fitLines(header, lines);
    expect(out.length).toBeLessThanOrEqual(2000);

    const [first, ...rest] = out.split('\n');
    expect(first).toBe(header);
    const tail = rest.pop()!;
    // Chaque ligne gardée est une ligne d'origine, intacte, dans l'ordre.
    expect(rest).toEqual(lines.slice(0, rest.length));
    expect(tail).toBe(`… and ${32 - rest.length} more`);
    expect(rest.length).toBeGreaterThan(0);
  });

  it('respecte une autre limite', () => {
    const lines = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
    expect(fitLines('H', lines, 28)).toBe(`H\n${lines.join('\n')}`);
    const out = fitLines('H', lines, 26);
    expect(out.length).toBeLessThanOrEqual(26);
    expect(out).toBe('H\naaaaaaaa\n… and 2 more');
  });
});
