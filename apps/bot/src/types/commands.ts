import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SharedSlashCommand,
} from "discord.js";
import type { BotContext } from "./context.js";

export interface BotCommand {
  data: SharedSlashCommand;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void>;
}

export interface BotEvent<E extends string = string> {
  name: E;
  once?: boolean;
  execute(...args: [...unknown[], BotContext]): Promise<void>;
}
