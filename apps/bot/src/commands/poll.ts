import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction, type Guild } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";

// Regional indicator emojis: 🇦 through 🇹 (A-T, 20 options max)
const REGIONAL_INDICATORS = Array.from({ length: 20 }, (_, i) =>
  String.fromCodePoint(0x1f1e6 + i),
);

// Match Discord custom emoji <a?:name:id> or Unicode emoji at the start
const CUSTOM_EMOJI_RE = /^(<a?:\w+:\d+>)\s*/;
const UNICODE_EMOJI_RE = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?[\u200D\uFE0F\p{Emoji_Component}]*)\s*/u;

interface PollOption {
  emoji: string;
  label: string;
}

function parseOption(raw: string, index: number, guild: Guild | null): PollOption {
  // Check for Discord custom emoji format: <:name:id> or <a:name:id>
  const customMatch = raw.match(CUSTOM_EMOJI_RE);
  if (customMatch) {
    return {
      emoji: customMatch[1]!,
      label: raw.slice(customMatch[0].length).trim() || raw,
    };
  }

  // Check for Unicode emoji
  const unicodeMatch = raw.match(UNICODE_EMOJI_RE);
  if (unicodeMatch) {
    return {
      emoji: unicodeMatch[1]!,
      label: raw.slice(unicodeMatch[0].length).trim() || raw,
    };
  }

  // Check for :name: shortcode — resolve from guild emojis
  const shortcodeMatch = raw.match(/^:(\w+):\s*/);
  if (shortcodeMatch && guild) {
    const emojiName = shortcodeMatch[1]!;
    const guildEmoji = [...guild.emojis.cache.values()].find((e) => e.name === emojiName);
    if (guildEmoji) {
      const displayStr = guildEmoji.animated
        ? `<a:${guildEmoji.name}:${guildEmoji.id}>`
        : `<:${guildEmoji.name}:${guildEmoji.id}>`;
      return {
        emoji: displayStr,
        label: raw.slice(shortcodeMatch[0].length).trim() || raw,
      };
    }
  }

  return {
    emoji: REGIONAL_INDICATORS[index]!,
    label: raw.trim(),
  };
}

const builder = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("Create a poll")
  .addStringOption((opt) =>
    opt.setName("question").setDescription("The poll question").setRequired(true),
  );

// Add 20 optional option arguments
for (let i = 1; i <= 20; i++) {
  builder.addStringOption((opt) =>
    opt.setName(`option${i}`).setDescription(`Option ${i} — you can add an emoji before text (e.g. 🐉 Dragon)`).setRequired(false),
  );
}

const command: BotCommand = {
  skipDefer: true,
  data: builder,

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    const question = interaction.options.getString("question", true);

    // Ensure guild emojis are cached for custom emoji resolution
    if (interaction.guild) {
      await interaction.guild.emojis.fetch().catch(() => {});
    }

    // Collect provided options
    const rawOptions: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const val = interaction.options.getString(`option${i}`);
      if (val) rawOptions.push(val);
    }

    // Default: yes/no poll
    if (rawOptions.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 ${question}`)
        .setFooter({
          text: `Poll by ${interaction.user.displayName}`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
      await reply.react("👍");
      await reply.react("👎");
      return;
    }

    // Multi-option poll
    const options = rawOptions.map((raw, i) => parseOption(raw, i, interaction.guild));

    const description = options
      .map((opt) => `${opt.emoji} ${opt.label}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setFooter({
        text: `Poll by ${interaction.user.displayName}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    const reply = await interaction.reply({ embeds: [embed], fetchReply: true });

    // Add reactions in order
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      try {
        // Custom emojis: react() needs "name:id" format, not "<:name:id>"
        const customMatch = opt.emoji.match(/^<a?:(\w+:\d+)>$/);
        await reply.react(customMatch ? customMatch[1]! : opt.emoji);
      } catch {
        // Fallback: emoji is from another server or unavailable — use regional indicator
        const fallback = REGIONAL_INDICATORS[i]!;
        opt.emoji = fallback;
        try {
          await reply.react(fallback);
        } catch (err) {
          ctx.logger.warn({ err, emoji: fallback }, "Failed to add poll fallback reaction");
        }
      }
    }

    // Update embed if any emojis fell back
    const updatedDescription = options
      .map((opt) => `${opt.emoji} ${opt.label}`)
      .join("\n");
    if (updatedDescription !== description) {
      embed.setDescription(updatedDescription);
      await reply.edit({ embeds: [embed] });
    }
  },
};

export default command;
