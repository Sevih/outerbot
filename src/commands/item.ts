/**
 * /item — fiche express d'un équipement. Le contrat `/api/bot/items` arrive
 * PRÉ-FORMATÉ du site (nom d'effet + paliers en texte) : un seul renderer
 * générique remplace les cinq renderers du bot V2.
 */
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { wiki, type WikiItem } from '../wiki/client.js';
import { safeAutocomplete } from './helpers.js';
import type { Command } from './types.js';

const EMBED_COLOR = 0xe53e3e;

const TYPE_CHOICES = [
  { name: 'Weapon', value: 'weapon' },
  { name: 'Amulet', value: 'amulet' },
  { name: 'Set', value: 'set' },
  { name: 'Exclusive Equipment', value: 'ee' },
  { name: 'Talisman', value: 'talisman' },
] as const;

function itemEmbed(item: WikiItem): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(item.name).setColor(EMBED_COLOR);
  if (item.icon) embed.setThumbnail(`${config.imgBaseUrl}${item.icon}`);
  if (item.characterName)
    embed.addFields({ name: 'Hero', value: item.characterName, inline: true });
  if (item.classLimit) embed.addFields({ name: 'Class', value: item.classLimit, inline: true });
  if (item.effectName || item.effectTiers?.length) {
    embed.addFields({
      name: item.effectName ?? 'Effect',
      value: (item.effectTiers ?? []).join('\n') || '​',
    });
  }
  if (item.source) embed.setFooter({ text: `Source: ${item.source}` });
  embed.addFields({
    name: '​',
    value: `🔗 [View on Outerpedia](${config.siteBaseUrl}/equipment/${item.slug})`,
  });
  return embed;
}

export const itemCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Search for an item (weapon, amulet, set, EE, talisman)')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Item type')
        .setRequired(true)
        .addChoices(...TYPE_CHOICES),
    )
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Item name (or hero name for EE)')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const type = interaction.options.getString('type');
    if (!type) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    const items = await wiki.getItems();
    const names = items
      .filter((i) => i.type === type)
      .map((i) => (i.type === 'ee' && i.characterName ? `${i.characterName} — ${i.name}` : i.name));
    await safeAutocomplete(interaction, names);
  },

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const name = interaction.options.getString('name', true);
    const items = await wiki.getItems();

    // L'autocomplete des EE propose « Porteur — Nom » : on matche les deux formes.
    const target = items.find(
      (i) =>
        i.type === type &&
        (i.name.toLowerCase() === name.toLowerCase() ||
          (i.characterName &&
            `${i.characterName} — ${i.name}`.toLowerCase() === name.toLowerCase())),
    );
    if (!target) {
      await interaction.reply({ content: '❌ Item not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ embeds: [itemEmbed(target)] });
  },
};
