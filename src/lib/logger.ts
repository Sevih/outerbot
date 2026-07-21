/**
 * Logs structurés minimaux — stdout/stderr, un préfixe de niveau, l'heure UTC.
 * Docker capte la sortie ; pas de fichier, pas de dépendance.
 */
function line(level: string, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const detail =
    extra === undefined
      ? ''
      : ' ' + (extra instanceof Error ? extra.message : JSON.stringify(extra));
  return `${ts} [${level}] ${msg}${detail}`;
}

export const logger = {
  info: (msg: string, extra?: unknown) => console.log(line('info', msg, extra)),
  warn: (msg: string, extra?: unknown) => console.warn(line('warn', msg, extra)),
  error: (msg: string, extra?: unknown) => console.error(line('error', msg, extra)),
};
