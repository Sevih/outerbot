/** Petits partagés des commandes. */
import type { AutocompleteInteraction } from 'discord.js';

/**
 * Répond à un autocomplete en filtrant sur la saisie, sans jamais jeter (une
 * interaction expirée ne doit pas devenir une erreur de commande).
 */
export async function safeAutocomplete(
  interaction: AutocompleteInteraction,
  values: string[],
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = values
    .filter((v) => v.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((v) => ({ name: v, value: v }));
  await interaction.respond(choices).catch(() => {});
}
