/**
 * outerbot — point d'entrée. Ordre de boot :
 *   1. config (fail-fast si un secret manque) → db → client Discord ;
 *   2. à la connexion : listeners reviews, boucle de forum-sync, API HTTP ;
 *   3. si la base est VIDE de threads (premier démarrage / migration), un
 *      resync complet depuis Discord reconstruit l'index tout seul.
 * Arrêt propre sur SIGTERM/SIGINT (Docker stop).
 */
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { config } from './config.js';
import { openDb } from './db/db.js';
import { Store } from './db/store.js';
import { logger } from './lib/logger.js';
import { consume } from './lib/rate-limiter.js';
import { commandsByName } from './commands/index.js';
import { attachReviewListeners } from './reviews/listener.js';
import { startForumSyncLoop } from './reviews/forum-sync.js';
import { resyncFromDiscord } from './reviews/resync.js';
import { startHttpServer } from './http/server.js';

const db = openDb(config.db.path);
const store = new Store(db);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Les réactions arrivent sur des messages non cachés (vieux threads) :
  // sans les partials, ces events seraient silencieusement perdus.
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

attachReviewListeners(client, store);

client.once(Events.ClientReady, (ready) => {
  logger.info(`connecté : ${ready.user.tag}`);

  // Migration/réparation : base sans threads → reconstruction depuis Discord.
  const boot = async (): Promise<void> => {
    if (store.knownSlugs().size === 0) {
      logger.info('base vide — resync complet depuis Discord…');
      await resyncFromDiscord(client, store);
    }
    startForumSyncLoop(client, store);
  };
  void boot().catch((e) => logger.error('boot échoué', e));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command) return;

    // Rate limit par utilisateur (l'admin en est exempt).
    if (interaction.user.id !== config.discord.adminUserId) {
      const check = consume(interaction.user.id);
      if (!check.allowed) {
        void interaction
          .reply({
            content: `⏳ Too many requests. Please wait ${check.retryInS}s.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return;
      }
    }

    void command.execute(interaction, { store }).catch(async (e: unknown) => {
      logger.error(`commande /${interaction.commandName} en erreur`, e);
      const msg = { content: '❌ An error occurred.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred)
        await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    });
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName);
    void command?.autocomplete?.(interaction, { store }).catch((e: unknown) => {
      logger.error(`autocomplete /${interaction.commandName} en erreur`, e);
    });
  }
});

const httpServer = startHttpServer(store, client);

const shutdown = (signal: string): void => {
  logger.info(`${signal} reçu — arrêt propre`);
  httpServer.close();
  void client.destroy().finally(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void client.login(config.discord.token);
