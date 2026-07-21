/**
 * /char — fiche express d'un perso : lien wiki, thread de build EvaMains curé
 * (DB, commande /admin link), infographic éventuelle. Filtres élément/classe.
 */
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { wiki } from '../wiki/client.js';
import { safeAutocomplete } from './helpers.js';
import type { Command } from './types.js';

const EMBED_COLOR = 0xe53e3e;

const threadUrl = (threadId: string): string =>
  `https://discord.com/channels/${config.discord.guildId}/${threadId}`;

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
      const fields = [
        {
          name: '🕮 Character Full Guide',
          value: `[View on Website](${config.siteBaseUrl}/characters/${target.slug})`,
        },
      ];
      const build = store.buildThread(target.slug);
      if (build) {
        fields.push({
          name: '💬 Build Thread',
          value: `[View on Discord](${threadUrl(build.threadId)})`,
        });
        if (build.infoThreadId) {
          fields.push({
            name: '📊 Infographic',
            value: `[View on Discord](${threadUrl(build.infoThreadId)})`,
          });
        }
      }
      const embed = new EmbedBuilder()
        .setTitle(target.name)
        .setColor(EMBED_COLOR)
        // Face icon (FI_) : cadrée portrait, bien plus lisible en vignette
        // d'embed que le petit sprite ATB (IG_Turn_) — choix Sevih 21/07.
        .setThumbnail(`${config.imgBaseUrl}/images/characters/faceicon/FI_${target.id}.webp`)
        .addFields(fields);
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
      .map((c) => {
        const build = store.buildThread(c.slug);
        const buildLink = build ? ` ([💬](<${threadUrl(build.threadId)}>))` : '';
        return `• [${c.name}](${config.siteBaseUrl}/characters/${c.slug})${buildLink}`;
      })
      .join('\n')
      .slice(0, 2000);

    await interaction.reply({
      content: `👥 **Characters (${filtered.length})**\n${lines}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
