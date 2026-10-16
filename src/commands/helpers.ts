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
  await safeAutocompleteChoices(
    interaction,
    values.map((v) => ({ name: v, value: v })),
  );
}

/** Variante qui montre `name` et rend `value` (un nom affiché, un id rendu). */
export async function safeAutocompleteChoices(
  interaction: AutocompleteInteraction,
  choices: { name: string; value: string }[],
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const matching = choices.filter((c) => c.name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(matching).catch(() => {});
}
