/**
 * Le SEUL assemblage d'une adresse à partir d'un chemin servi par le site
 * (`href`, `icon`, `thumb`) : le bot ne reconstruit aucun chemin du site, il
 * préfixe ce qu'il reçoit. Un chemin absent (site pas encore à jour) donne
 * `undefined` : l'appelant omet le lien ou la vignette, il ne devine rien.
 * L'avertissement « champ absent » est journalisé par le client (client.ts).
 */
export const joinUrl = (base: string, path: string | undefined): string | undefined =>
  path ? `${base}${path}` : undefined;
