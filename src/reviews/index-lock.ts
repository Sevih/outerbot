/**
 * Verrou de l'index des posts — partagé par le forum-sync et le resync.
 *
 * Le resync relit les posts connus puis RÉÉCRIT la table entière en fin de
 * scan ; un post que le forum-sync créerait pendant ce temps serait effacé de
 * l'index, puis recréé au passage suivant (doublon dans le forum). Les deux
 * passent donc l'un après l'autre : chacun attend que l'autre ait fini.
 */
let tail: Promise<unknown> = Promise.resolve();

/** Exécute `fn` quand les passages précédents sont finis (réussis ou non). */
export function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}
