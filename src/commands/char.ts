/**
 * /char — fiche express d'un perso : lien wiki, thread de build EvaMains curé
 * (DB, commande /admin link), infographic éventuelle. Filtres élément/classe.
 */
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { fitLines } from '../lib/text.js';
import { wiki, type WikiCharacter } from '../wiki/client.js';
import { joinUrl } from '../wiki/links.js';
import { safeAutocomplete } from './helpers.js';
import type { Command } from './types.js';

const EMBED_COLOR = 0xe53e3e;

/** Fils de build curés d'un perso (`store.buildThread`). */
export interface BuildThreads {
  threadId: string;
  infoThreadId: string | null;
}

/** Adresses dont dépend le rendu (config en prod, valeurs fixes en test). */
export interface CharBases {
  siteBaseUrl: string;
  imgBaseUrl: string;
  guildId: string;
}

const threadUrl = (guildId: string, threadId: string): string =>
  `https://discord.com/channels/${guildId}/${threadId}`;

/** Fiche d'un perso. Sans `href` ni `icon` du site, le lien ou la vignette est omis. */
export function charEmbed(
  target: WikiCharacter,
  build: BuildThreads | undefined,
  bases: CharBases,
): EmbedBuilder {
  const fields: { name: string; value: string }[] = [];
  const page = joinUrl(bases.siteBaseUrl, target.href);
  if (page) fields.push({ name: '🕮 Character Full Guide', value: `[View on Website](${page})` });
  if (build) {
    fields.push({
      name: '💬 Build Thread',
      value: `[View on Discord](${threadUrl(bases.guildId, build.threadId)})`,
    });
    if (build.infoThreadId) {
      fields.push({
        name: '📊 Infographic',
        value: `[View on Discord](${threadUrl(bases.guildId, build.infoThreadId)})`,
      });
    }
  }
  const embed = new EmbedBuilder().setTitle(target.name).setColor(EMBED_COLOR);
  // Face icon (FI_) : cadrée portrait, bien plus lisible en vignette
  // d'embed que le petit sprite ATB (IG_Turn_) — choix Sevih 21/07.
  const icon = joinUrl(bases.imgBaseUrl, target.icon);
  if (icon) embed.setThumbnail(icon);
  if (fields.length) embed.addFields(fields);
  return embed;
}

/** Une ligne de la liste filtrée ; sans `href`, le nom reste sans lien. */
export function charListLine(
  c: WikiCharacter,
  build: BuildThreads | undefined,
  bases: CharBases,
): string {
  const page = joinUrl(bases.siteBaseUrl, c.href);
  const buildLink = build ? ` ([💬](<${threadUrl(bases.guildId, build.threadId)}>))` : '';
  return `• ${page ? `[${c.name}](${page})` : c.name}${buildLink}`;
}

const bases = (): CharBases => ({
  siteBaseUrl: config.siteBaseUrl,
  imgBaseUrl: config.imgBaseUrl,
  guildId: config.discord.guildId,
});

export const charCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('char')
    .setDescription('Query characters from Outerpedia')
    .addStringOption((o) =>
      o.setName('name').setDescription('Character name').setAutocomplete(true),
    )
    .addStringOption((o) =>
      o.setName('element').setDescription('Filter by element').setAutocomplete(true),
    )
    .addStringOption((o) =>
      o.setName('class').setDescription('Filter by class').setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const characters = await wiki.getCharacters();
    const values =
      focused.name === 'name'
        ? characters.map((c) => c.name)
        : focused.name === 'element'
          ? [...new Set(characters.map((c) => c.element))]
          : [...new Set(characters.map((c) => c.class))];
    await safeAutocomplete(interaction, values);
  },

  async execute(interaction, { store }) {
    const name = interaction.options.getString('name');
    const element = interaction.options.getString('element');
    const klass = interaction.options.getString('class');
    const characters = await wiki.getCharacters();

    if (!name && !element && !klass) {
      await interaction.reply(`📚 [Browse all characters](${config.siteBaseUrl}/characters)`);
      return;
    }

    if (name) {
      const target = characters.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!target) {
        await interaction.reply({
          content: '❌ Character not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = charEmbed(target, store.buildThread(target.id), bases());
      await interaction.reply({ embeds: [embed] });
      return;
    }

    let filtered = characters;
    if (element) filtered = filtered.filter((c) => c.element === element.toLowerCase());
    if (klass) filtered = filtered.filter((c) => c.class === klass.toLowerCase());
    if (filtered.length === 0) {
      await interaction.reply({
        content: '❌ No characters matched the filter.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = filtered
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => charListLine(c, store.buildThread(c.id), bases()));

    await interaction.reply({
      content: fitLines(`👥 **Characters (${filtered.length})**`, lines),
      flags: MessageFlags.Ephemeral,
    });
  },
};
