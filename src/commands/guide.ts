/** /guide — liens vers les guides du wiki, par catégorie ou par titre. */
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { wiki } from '../wiki/client.js';
import type { Command } from './types.js';

/** « world-boss » → « World Boss ». */
const pretty = (slug: string): string =>
  slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const guideCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('guide')
    .setDescription('Find a guide by category or name')
    .addStringOption((o) =>
      o.setName('category').setDescription('Guide category').setAutocomplete(true),
    )
    .addStringOption((o) => o.setName('guide').setDescription('Guide title').setAutocomplete(true)),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const focused = interaction.options.getFocused().toLowerCase();
    const guides = await wiki.getGuides();

    if (focusedOption.name === 'category') {
      const categories = [...new Set(guides.map((g) => g.category))];
      const choices = categories
        .map((c) => ({ name: pretty(c), value: c }))
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25);
      await interaction.respond(choices).catch(() => {});
      return;
    }

    const category = interaction.options.getString('category');
    const pool = category ? guides.filter((g) => g.category === category) : guides;
    const choices = pool
      .filter((g) => g.title.toLowerCase().includes(focused))
      .slice(0, 25)
      // value = « catégorie/slug » : l'exécution retrouve le guide sans ambiguïté.
      .map((g) => ({ name: g.title, value: `${g.category}/${g.slug}` }));
    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    const category = interaction.options.getString('category');
    const guideRef = interaction.options.getString('guide');
    const guides = await wiki.getGuides();

    if (!category && !guideRef) {
      await interaction.reply(`📚 [Browse all guides](${config.siteBaseUrl}/guides)`);
      return;
    }

    if (guideRef) {
      const [cat, slug] = guideRef.includes('/') ? guideRef.split('/', 2) : [null, guideRef];
      const guide = guides.find((g) => g.slug === slug && (!cat || g.category === cat));
      if (!guide) {
        await interaction.reply({ content: '❌ Guide not found.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply(
        `📖 [${pretty(guide.category)} : ${guide.title}](${config.siteBaseUrl}/guides/${guide.category}/${guide.slug})`,
      );
      return;
    }

    const inCategory = guides.filter((g) => g.category === category);
    if (inCategory.length === 0) {
      await interaction.reply({
        content: `❌ No guides found in category \`${category}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content:
        `📂 **${pretty(category!)}** contains:\n${inCategory.map((g) => `• ${g.title}`).join('\n')}`.slice(
          0,
          2000,
        ),
      flags: MessageFlags.Ephemeral,
    });
  },
};
