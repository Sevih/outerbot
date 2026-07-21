/**
 * Enregistre les slash commands auprès de Discord (scope guild — mise à jour
 * instantanée). À lancer après tout changement de définition de commande :
 * `pnpm deploy-commands`.
 */
import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';

const rest = new REST().setToken(config.discord.token);

const body = commands.map((c) => c.data.toJSON());
await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
  body,
});
console.log(`✅ ${body.length} commande(s) enregistrée(s) : ${body.map((c) => c.name).join(', ')}`);
