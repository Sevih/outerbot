/**
 * /admin — les gestes d'exploitation, DANS Discord (fini les scripts SSH du
 * bot V2) :
 *   sync    — crée les posts forum des nouveaux persos (le cron le fait déjà,
 *             ceci force sans attendre) ;
 *   resync  — reconstruit tout l'index reviews depuis Discord (migration,
 *             réparation) ;
 *   link    — pose/màj le thread de build curé d'un perso (ex-threads.json) ;
 *   unlink  — le retire.
 * Réservé à l'admin par l'ADMIN_USER_ID, vérifié À L'EXÉCUTION (les autres
 * reçoivent « Admin only » en éphémère). PAS de defaultMemberPermissions=0 :
 * ça masque la commande à quiconque n'a pas la permission Administrateur du
 * serveur — y compris à l'admin du BOT, qui ne l'a pas sur EvaMains (constaté).
 */
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { syncForumPosts } from '../reviews/forum-sync.js';
import { resyncFromDiscord } from '../reviews/resync.js';
import { wiki } from '../wiki/client.js';
import { safeAutocomplete } from './helpers.js';
import type { Command } from './types.js';

/** Extrait l'id de thread d'un lien Discord (ou accepte l'id nu). */
function threadIdFrom(input: string): string | null {
  const m = input.match(/discord\.com\/channels\/\d+\/(\d+)/) ?? input.match(/^(\d{15,})$/);
  return m ? m[1]! : null;
}

export const adminCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Outerbot administration')
    .addSubcommand((s) =>
      s.setName('sync').setDescription('Create forum posts for new characters now'),
    )
    .addSubcommand((s) =>
      s.setName('resync').setDescription('Rebuild the whole review index from Discord'),
    )
    .addSubcommand((s) =>
      s
        .setName('link')
        .setDescription('Set the curated build thread for a character')
        .addStringOption((o) =>
          o
            .setName('character')
            .setDescription('Character')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o.setName('thread').setDescription('Build thread link or id').setRequired(true),
        )
        .addStringOption((o) => o.setName('infographic').setDescription('Infographic link or id')),
    )
    .addSubcommand((s) =>
      s
        .setName('unlink')
        .setDescription('Remove the curated build thread of a character')
        .addStringOption((o) =>
          o
            .setName('character')
            .setDescription('Character')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async autocomplete(interaction) {
    const characters = await wiki.getCharacters();
    await safeAutocomplete(
      interaction,
      characters.map((c) => c.slug),
    );
  },

  async execute(interaction, { store }) {
    if (interaction.user.id !== config.discord.adminUserId) {
      await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'sync') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await syncForumPosts(interaction.client, store, true);
      await interaction.editReply(
        report.created.length || report.failed.length
          ? `✅ ${report.created.length} post(s) créé(s)` +
              (report.created.length ? ` : ${report.created.join(', ')}` : '') +
              (report.failed.length ? ` · ⚠ échec(s) : ${report.failed.join(', ')}` : '')
          : `✓ Rien à créer — les ${report.total} persos ont leur post.`,
      );
      return;
    }

    if (sub === 'resync') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await resyncFromDiscord(interaction.client, store);
      await interaction.editReply(
        `✅ Resync : ${report.reviews} review(s) sur ${report.threads} thread(s).` +
          (report.unresolved.length
            ? `\n⚠ Threads non reliés (à /admin link ou renommer) : ${report.unresolved.join(', ')}`
            : ''),
      );
      return;
    }

    if (sub === 'link') {
      const slug = interaction.options.getString('character', true);
      const thread = threadIdFrom(interaction.options.getString('thread', true));
      const infoRaw = interaction.options.getString('infographic');
      const info = infoRaw ? threadIdFrom(infoRaw) : null;
      if (!thread || (infoRaw && !info)) {
        await interaction.reply({
          content: '❌ Invalid thread link/id.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      store.setBuildThread(slug, thread, info ?? undefined);
      await interaction.reply({
        content: `✅ Build thread lié pour **${slug}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'unlink') {
      const slug = interaction.options.getString('character', true);
      const removed = store.removeBuildThread(slug);
      await interaction.reply({
        content: removed ? `✅ Lien retiré pour **${slug}**.` : `— Aucun lien pour **${slug}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
