/** Petits outils de texte PURS (sans Discord), partagés par les commandes. */

/**
 * En-tête + lignes, sous `limit` caractères (2000 pour un message Discord) :
 * on garde des lignes ENTIÈRES (jamais un lien coupé) et, si tout ne tient pas,
 * on finit par « … and N more ». La longueur se compte en unités UTF-16, comme
 * JavaScript : c'est au moins autant que ce que Discord compte.
 */
export function fitLines(header: string, lines: readonly string[], limit = 2000): string {
  const full = [header, ...lines].join('\n');
  if (full.length <= limit) return full;

  // Place réservée à la ligne de fin, au pire cas (N = toutes les lignes).
  const reserve = `\n… and ${lines.length} more`.length;
  let out = header;
  let kept = 0;
  for (const line of lines) {
    if (out.length + 1 + line.length + reserve > limit) break;
    out += `\n${line}`;
    kept++;
  }
  return `${out}\n… and ${lines.length - kept} more`;
}
