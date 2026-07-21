/** Contrat d'une commande slash du bot. */
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Store } from '../db/store.js';

export interface CommandContext {
  store: Store;
}

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, ctx: CommandContext) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, ctx: CommandContext) => Promise<void>;
}
