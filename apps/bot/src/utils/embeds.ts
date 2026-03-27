import { EmbedBuilder } from "discord.js";

const COLORS = {
  success: 0x43b581,
  error: 0xff0000,
  info: 0xffcc00,
  log: 0x5865f2,
} as const;

export function successEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.success).setDescription(description);
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.error).setDescription(description);
}

export function infoEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.info).setDescription(description);
}

export function logEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.log)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}
