import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  Collection,
  MessageFlags,
  REST,
  Routes,
  type Client,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { BotCommand, BotEvent } from "./types/commands.js";
import type { BotContext } from "./types/context.js";
import type { Logger } from "pino";

export async function loadCommands(
  commandsDir: string,
  logger: Logger,
): Promise<Collection<string, BotCommand>> {
  const commands = new Collection<string, BotCommand>();
  const files = await readdir(commandsDir);

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

    const filePath = path.join(commandsDir, file);
    const mod = (await import(pathToFileURL(filePath).href)) as { default: BotCommand };
    const command = mod.default;

    if (!command?.data?.name) {
      logger.warn({ file }, "Skipping command file — no valid export");
      continue;
    }

    commands.set(command.data.name, command);
    logger.info({ command: command.data.name }, "Loaded command");
  }

  return commands;
}

export async function registerCommands(
  commands: Collection<string, BotCommand>,
  clientId: string,
  token: string,
  logger: Logger,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map((cmd) => cmd.data.toJSON());

  await rest.put(Routes.applicationCommands(clientId), { body });
  logger.info({ count: body.length }, "Registered slash commands globally");
}

export async function loadEvents(
  eventsDir: string,
  client: Client,
  ctx: BotContext,
  logger: Logger,
): Promise<void> {
  const files = await readdir(eventsDir);

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

    const filePath = path.join(eventsDir, file);
    const mod = (await import(pathToFileURL(filePath).href)) as { default: BotEvent };
    const event = mod.default;

    if (!event?.name) {
      logger.warn({ file }, "Skipping event file — no valid export");
      continue;
    }

    const safeHandler = (...args: unknown[]) => {
      Promise.resolve(event.execute(...args, ctx)).catch((err) => {
        logger.error({ err, event: event.name }, "Unhandled error in event handler");
      });
    };

    if (event.once) {
      client.once(event.name, safeHandler);
    } else {
      client.on(event.name, safeHandler);
    }

    logger.info({ event: event.name, once: event.once ?? false }, "Loaded event");
  }
}

export function bindInteractionHandler(
  client: Client,
  commands: Collection<string, BotCommand>,
  ctx: BotContext,
): void {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;

      const log = ctx.logger.child({
        command: interaction.commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
      });

      try {
        // Auto-defer to prevent Discord's 3-second timeout on slow DB/API calls
        if (!command.skipDefer) {
          await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
        }
        await command.execute(interaction as ChatInputCommandInteraction, ctx);
      } catch (err) {
        log.error({ err }, "Unhandled error in command");
        const reply = {
          content: "Something went wrong. Please try again later.",
          flags: MessageFlags.Ephemeral as number,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
    } else if (interaction.isModalSubmit()) {
      // Modal IDs are formatted as "commandName:action"
      const commandName = interaction.customId.split(":")[0] ?? "";
      if (!commandName) return;
      const command = commands.get(commandName);
      if (!command?.modal) return;

      try {
        await command.modal(interaction as ModalSubmitInteraction, ctx);
      } catch (err) {
        ctx.logger.error({ err, customId: interaction.customId }, "Unhandled error in modal");
      }
    }
  });
}
