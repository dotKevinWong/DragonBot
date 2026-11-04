import type { ChatInputCommandInteraction } from "discord.js";
import { AppError } from "../types/errors.js";
import { errorEmbed } from "./embeds.js";

// Replies shared by deferred slash commands. Both use editReply, so call them only after the loader's auto-defer
// (never from a skipDefer command). Neither passes flags: ephemerality comes from the defer.

/**
 * Tells the user the command only works in a server. Each command keeps its own check (most test `guildId`, some the
 * cached `guild`), then calls this: `if (!interaction.guildId) { await replyServerOnly(interaction); return; }`.
 */
export async function replyServerOnly(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
}

/**
 * The end of a command's catch block: an AppError's message is shown as is and not logged. Anything else runs
 * `logUnhandled` (so each command keeps its own logger, message and fields), then shows "Something went wrong.".
 */
export async function replyAppErrorOrFail(
  interaction: ChatInputCommandInteraction,
  err: unknown,
  logUnhandled: () => void,
): Promise<void> {
  if (err instanceof AppError) {
    await interaction.editReply({ embeds: [errorEmbed(err.message)] });
    return;
  }
  logUnhandled();
  await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
}
