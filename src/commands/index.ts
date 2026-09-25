/** Registre des commandes — l'unique liste, partagée par le boot et le deploy. */
import type { Command } from './types.js';
import { adminCommand } from './admin.js';
import { charCommand } from './char.js';
import { couponCommand } from './coupon.js';
import { guideCommand } from './guide.js';
import { itemCommand } from './item.js';
import { helpCommand, statusCommand } from './misc.js';

export const commands: Command[] = [
  charCommand,
  itemCommand,
  guideCommand,
  helpCommand,
  statusCommand,
  adminCommand,
  couponCommand,
];

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
