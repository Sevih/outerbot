/**
 * Démarrage du forum-sync — logique PURE (dépendances injectées, testée à sec).
 *
 * Le forum-sync crée un post pour chaque perso absent de l'index : parti sur
 * une base vide, il doublerait tous les posts du forum. Sur base vide, l'index
 * se reconstruit donc d'abord depuis Discord (resync) ; un resync raté (site
 * pas encore prêt au redémarrage de la stack…) se retente après `retryMs`, tant
 * que la base reste vide.
 */
export interface IndexThenStartDeps {
  isEmpty: () => boolean;
  resync: () => Promise<unknown>;
  start: () => void;
  onError: (e: unknown) => void;
  retryMs: number;
}

export async function indexThenStart(deps: IndexThenStartDeps): Promise<void> {
  if (deps.isEmpty()) {
    try {
      await deps.resync();
    } catch (e) {
      deps.onError(e);
      setTimeout(() => void indexThenStart(deps), deps.retryMs);
      return;
    }
  }
  deps.start();
}
