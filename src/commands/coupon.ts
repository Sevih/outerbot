/**
 * /coupon — la porte d'entrée du STAFF pour les codes promo :
 *   add     — nouveau code ;
 *   edit    — corrige un code existant (dates, récompenses, le code lui-même) ;
 *   remove  — retire un code.
 *
 * Réservé aux rôles `STAFF_ROLE_IDS` et à l'admin, vérifié À L'EXÉCUTION
 * (même raison que /admin : pas de defaultMemberPermissions). Chaque geste
 * montre l'annonce telle qu'elle partira, puis attend « Confirm ».
 *
 * Le bot n'écrit rien lui-même : il envoie l'opération à la route interne du
 * site, qui valide et écrit la liste vivante sur R2. Un code confirmé est en
 * ligne sur le site immédiatement ; l'annonce part aussitôt (ou à sa date de
 * début).
 *
 * Récompenses et codes existants passent par l'AUTOCOMPLÉTION : la valeur
 * envoyée est l'id de l'item, jamais un texte tapé — pas de faute de frappe
 * possible. Les dates aussi sont suggérées.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { couponEmbed } from '../announce/core.js';
import { runAnnouncements } from '../announce/announcer.js';
import { couponApi, type CouponOp, type RawCoupon } from '../coupons/client.js';
import {
  canManageCoupons,
  codeChoices,
  dateChoices,
  isDate,
  MAX_REWARDS,
  popularRewards,
  rewardChoices,
  rewardsFromInputs,
  toAnnouncement,
  toRaw,
  type RewardInput,
} from '../coupons/core.js';
import type { Command, CommandContext } from './types.js';

/** Temps laissé pour cliquer « Confirm ». */
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Options `rewardN` (autocomplétion) + `qtyN`, la 1re paire requise ou non. */
function addRewardPairs(
  s: SlashCommandSubcommandBuilder,
  from: number,
  required: boolean,
): SlashCommandSubcommandBuilder {
  for (let n = from; n <= MAX_REWARDS; n++) {
    s.addStringOption((o) =>
      o
        .setName(`reward${n}`)
        .setDescription(`Reward ${n} — pick from the list`)
        .setAutocomplete(true)
        .setRequired(required),
    ).addIntegerOption((o) =>
      o
        .setName(`qty${n}`)
        .setDescription(`Quantity of reward ${n}`)
        .setMinValue(1)
        .setRequired(required),
    );
  }
  return s;
}

/** Option de date : texte libre, avec suggestions (aujourd'hui, +7 j…). */
const dateOption =
  (name: string, description: string, required: boolean) => (o: SlashCommandStringOption) =>
    o.setName(name).setDescription(description).setAutocomplete(true).setRequired(required);

function memberRoleIds(interaction: { member: ChatInputCommandInteraction['member'] }): string[] {
  const m = interaction.member;
  if (!m) return [];
  return m instanceof GuildMember ? [...m.roles.cache.keys()] : m.roles;
}

const allowed = (interaction: {
  user: { id: string };
  member: ChatInputCommandInteraction['member'];
}): boolean =>
  canManageCoupons(
    interaction.user.id,
    memberRoleIds(interaction),
    config.coupons.staffRoleIds,
    config.discord.adminUserId,
  );

function readRewards(interaction: ChatInputCommandInteraction): RewardInput[] {
  return Array.from({ length: MAX_REWARDS }, (_, i) => ({
    id: interaction.options.getString(`reward${i + 1}`),
    qty: interaction.options.getInteger(`qty${i + 1}`),
  }));
}

/** Construit l'opération à partir des options, ou le message d'erreur à afficher. */
async function buildOp(
  interaction: ChatInputCommandInteraction,
): Promise<{ op: CouponOp; preview: RawCoupon; verb: string } | { error: string }> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'remove') {
    const code = interaction.options.getString('code', true).trim();
    const existing = (await couponApi.list(true)).find((c) => c.code === code);
    if (!existing) return { error: `Code \`${code}\` not found.` };
    return { op: { action: 'remove', code }, preview: toRaw(existing), verb: 'Remove' };
  }

  const rewards = rewardsFromInputs(readRewards(interaction));
  if (!rewards.ok) return { error: rewards.error };

  let coupon: RawCoupon;
  let op: CouponOp;
  if (sub === 'add') {
    // Même règle que l'écran `pnpm quick` : un code se saisit en majuscules.
    coupon = {
      code: interaction.options.getString('code', true).trim().toUpperCase(),
      start: interaction.options.getString('start', true).trim(),
      end: interaction.options.getString('end', true).trim(),
      description: rewards.description,
    };
    op = { action: 'add', coupon };
  } else {
    const code = interaction.options.getString('code', true).trim();
    const existing = (await couponApi.list(true)).find((c) => c.code === code);
    if (!existing) return { error: `Code \`${code}\` not found.` };
    const base = toRaw(existing);
    const hasRewards = Object.keys(rewards.description).length > 0;
    coupon = {
      code: interaction.options.getString('new_code')?.trim().toUpperCase() || base.code,
      start: interaction.options.getString('start')?.trim() || base.start,
      end: interaction.options.getString('end')?.trim() || base.end,
      // Des récompenses données REMPLACENT toutes les anciennes (sinon, inchangées).
      description: hasRewards ? rewards.description : base.description,
    };
    op = { action: 'edit', code, coupon };
  }

  if (!isDate(coupon.start))
    return { error: `Invalid start date \`${coupon.start}\` (YYYY-MM-DD).` };
  if (!isDate(coupon.end)) return { error: `Invalid end date \`${coupon.end}\` (YYYY-MM-DD).` };
  if (coupon.end < coupon.start) return { error: 'The end date is before the start date.' };
  return { op, preview: coupon, verb: sub === 'add' ? 'Add' : 'Update' };
}

async function execute(interaction: ChatInputCommandInteraction, { store }: CommandContext) {
  if (!couponApi.enabled()) {
    await interaction.reply({
      content: '❌ Coupon management is not configured on this bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!allowed(interaction)) {
    await interaction.reply({ content: '❌ Staff only.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Réponse DIFFÉRÉE : la suite relit la liste vivante (R2, via le site), ce qui
  // peut dépasser les 3 s que Discord laisse pour répondre.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const built = await buildOp(interaction);
  if ('error' in built) {
    await interaction.editReply(`❌ ${built.error}`);
    return;
  }
  const { op, preview, verb } = built;

  const names = await couponApi.rewardNames(Object.keys(preview.description));
  const unknown = [...names].filter(([, name]) => name === null).map(([id]) => id);
  if (unknown.length) {
    await interaction.editReply(
      `❌ Unknown reward: ${unknown.join(', ')}. Pick rewards from the suggestion list.`,
    );
    return;
  }

  const upcoming = preview.start > todayUtc();
  const confirm = new ButtonBuilder()
    .setCustomId('coupon-confirm')
    .setLabel(verb)
    .setStyle(op.action === 'remove' ? ButtonStyle.Danger : ButtonStyle.Success);
  const cancel = new ButtonBuilder()
    .setCustomId('coupon-cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);
  const intro =
    op.action === 'remove'
      ? `**Remove \`${preview.code}\`?** It disappears from the site right away.`
      : `**${verb} this coupon?** Preview of the announcement:` +
        (upcoming ? `\n-# Starts ${preview.start}: live and announced on that day.` : '');

  const message = await interaction.editReply({
    content: intro,
    embeds: [couponEmbed(toAnnouncement(preview, names), config.siteBaseUrl)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel)],
  });

  const click = await message
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      time: CONFIRM_TIMEOUT_MS,
      filter: (i) => i.user.id === interaction.user.id,
    })
    .catch(() => undefined);

  if (!click) {
    await interaction
      .editReply({ content: '⌛ Timed out — nothing changed.', embeds: [], components: [] })
      .catch(() => {});
    return;
  }
  if (click.customId === 'coupon-cancel') {
    await click.update({ content: 'Cancelled — nothing changed.', embeds: [], components: [] });
    return;
  }

  await click.update({ content: '⏳ Saving…', components: [] });
  const res = await couponApi.apply(op);
  if (!res.ok) {
    await interaction.editReply({
      content: `❌ Not saved:\n${res.errors.map((e) => `• ${e}`).join('\n')}`,
      embeds: [],
    });
    return;
  }

  logger.info(`coupon ${op.action}`, { by: interaction.user.tag, code: preview.code });
  // Annoncé : un code NOUVEAU pour la boucle (ajout, ou renommage — l'annonce
  // porte le code, un code corrigé doit repartir). Un edit qui garde le code ne
  // reposte pas : l'annonce d'origine reste telle quelle.
  const announces =
    Boolean(config.announce.channelId) &&
    (op.action === 'add' || (op.action === 'edit' && preview.code !== op.code));
  const announced = !announces
    ? ''
    : upcoming
      ? ` Announcement on ${preview.start}.`
      : ` Announcement going to <#${config.announce.channelId}> within a minute.`;
  await interaction.editReply({
    content: `✅ ${op.action === 'remove' ? 'Removed' : 'Saved'} — live on the site.${announced}`,
    ...(op.action === 'remove' ? { embeds: [] } : {}),
  });

  // Pas d'attente de la boucle d'annonce : le passage est lancé tout de suite.
  if (announces && !upcoming) {
    void runAnnouncements(interaction.client, store).catch((e) =>
      logger.error('annonce après /coupon échouée', e),
    );
  }
}

export const couponCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('coupon')
    .setDescription('Manage Outerplane coupon codes (staff)')
    .addSubcommand((s) =>
      addRewardPairs(
        s
          .setName('add')
          .setDescription('Add a coupon code')
          .addStringOption((o) =>
            o.setName('code').setDescription('The code players type').setRequired(true),
          )
          // `start` OBLIGATOIRE : Discord range toutes les options requises avant
          // les facultatives — facultatif, il finissait après les 8 champs de
          // récompenses 2 à 5. « today » est la première suggestion.
          .addStringOption(dateOption('start', 'First valid day (UTC), YYYY-MM-DD', true))
          .addStringOption(dateOption('end', 'Last valid day (UTC), YYYY-MM-DD', true)),
        1,
        true,
      ),
    )
    .addSubcommand((s) =>
      addRewardPairs(
        s
          .setName('edit')
          .setDescription('Edit a coupon (rewards given here replace all its rewards)')
          .addStringOption((o) =>
            o
              .setName('code')
              .setDescription('Coupon to edit')
              .setAutocomplete(true)
              .setRequired(true),
          )
          .addStringOption((o) => o.setName('new_code').setDescription('Rename the code'))
          .addStringOption(dateOption('start', 'New first valid day, YYYY-MM-DD', false))
          .addStringOption(dateOption('end', 'New last valid day, YYYY-MM-DD', false)),
        1,
        false,
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a coupon')
        .addStringOption((o) =>
          o
            .setName('code')
            .setDescription('Coupon to remove')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),

  async autocomplete(interaction) {
    if (!couponApi.enabled() || !allowed(interaction)) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    const focused = interaction.options.getFocused(true);
    const today = todayUtc();
    let choices;
    if (focused.name === 'code') {
      choices = codeChoices(await couponApi.list(), focused.value, today);
    } else if (focused.name === 'start' || focused.name === 'end') {
      choices = dateChoices(focused.value, today);
    } else {
      const q = focused.value.trim();
      choices = rewardChoices(
        q ? await couponApi.searchRewards(q) : popularRewards(await couponApi.list()),
      );
    }
    await interaction.respond(choices).catch(() => {});
  },

  execute,
};
