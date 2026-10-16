/** /help et /status — les commandes de service. */
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { wiki } from '../wiki/client.js';
import type { Command } from './types.js';

export const helpCommand: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription('What this bot can do'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Outerpedia Bot')
      .setColor(0xe53e3e)
      .setDescription(
        [
          '**/char** — character card (wiki link, build thread)',
          '**/item** — equipment lookup (weapon, amulet, set, EE, talisman)',
          '**/guide** — find a guide by category or title',
          '',
          `📝 Post your character reviews in <#${config.reviews.forumChannelId}> — format:`,
          '```\nX/5\nYour review here\n```',
          `They appear on [outerpedia.com](${config.siteBaseUrl}) character pages.`,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const statusCommand: Command = {
  data: new SlashCommandBuilder().setName('status').setDescription('Bot status'),
  async execute(interaction, { store }) {
    const wikiStatus = wiki.status();
    const known = store.knownCharacterIds();
    const characters = await wiki.getCharacters().catch(() => []);
    const missing = characters.filter((c) => !known.has(c.id)).map((c) => c.name);
    const unresolved = store.unresolvedSlugs();

    const lines = [
      `Reviews: **${store.countReviews()}** across **${store.countThreads()}** threads`,
      `Wiki data: **${wikiStatus.charactersCount}** characters (fetched ${wikiStatus.lastFetch ?? 'never'})`,
      `Last forum sync: ${store.getMeta('lastForumSync') ?? 'never'}`,
      `Last full resync: ${store.getMeta('lastResync') ?? 'never'}`,
      config.announce.channelId
        ? `Last announcement check: ${store.getMeta('lastAnnounceCheck') ?? 'never'}`
        : 'Announcements: off (ANNOUNCE_CHANNEL_ID not set)',
    ];
    if (missing.length) {
      lines.push(
        `⚠ Characters without a review thread: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? '…' : ''}`,
      );
    }
    if (unresolved.length) {
      lines.push(
        `⚠ Slugs without a character id: ${unresolved.slice(0, 15).join(', ')}${unresolved.length > 15 ? '…' : ''}`,
      );
    }
    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  },
};
