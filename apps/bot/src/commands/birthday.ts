import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed } from "../utils/embeds.js";

const MONTH_CHOICES = [
  { name: "January", value: 1 },
  { name: "February", value: 2 },
  { name: "March", value: 3 },
  { name: "April", value: 4 },
  { name: "May", value: 5 },
  { name: "June", value: 6 },
  { name: "July", value: 7 },
  { name: "August", value: 8 },
  { name: "September", value: 9 },
  { name: "October", value: 10 },
  { name: "November", value: 11 },
  { name: "December", value: 12 },
];

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Birthday commands")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your birthday")
        .addIntegerOption((opt) =>
          opt
            .setName("month")
            .setDescription("Birth month")
            .setRequired(true)
            .addChoices(...MONTH_CHOICES),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("day")
            .setDescription("Birth day (1-31)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("year")
            .setDescription("Birth year (optional, for age display)")
            .setRequired(false)
            .setMinValue(1900)
            .setMaxValue(new Date().getFullYear()),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Remove your birthday"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a user's birthday")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to check (defaults to you)").setRequired(false),
        ),
    ),

  ephemeral: true,

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    const sub = interaction.options.getSubcommand();
    const log = ctx.logger.child({ command: "birthday", sub, userId: interaction.user.id });

    try {
      if (sub === "set") {
        const month = interaction.options.getInteger("month", true);
        const day = interaction.options.getInteger("day", true);
        const year = interaction.options.getInteger("year") ?? null;

        await ctx.services.birthday.setBirthday(interaction.user.id, month, day, year);

        const formatted = ctx.services.birthday.formatBirthday(month, day, year);
        log.info({ month, day, year }, "Birthday set");
        await interaction.editReply({
          embeds: [successEmbed(`Your birthday has been set to **${formatted}**.`)],
        });
      } else if (sub === "remove") {
        await ctx.services.birthday.removeBirthday(interaction.user.id);
        log.info("Birthday removed");
        await interaction.editReply({
          embeds: [successEmbed("Your birthday has been removed.")],
        });
      } else if (sub === "view") {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const birthday = await ctx.services.birthday.getBirthday(targetUser.id);

        if (!birthday) {
          await interaction.editReply({
            embeds: [errorEmbed(
              targetUser.id === interaction.user.id
                ? "You haven't set a birthday yet. Use `/birthday set` to add one."
                : `${targetUser.displayName} hasn't set a birthday.`,
            )],
          });
          return;
        }

        const formatted = ctx.services.birthday.formatBirthday(birthday.birthMonth, birthday.birthDay, birthday.birthYear);
        const age = ctx.services.birthday.formatAge(birthday.birthYear);
        const description = age
          ? `**${formatted}** (${age} birthday this year)`
          : `**${formatted}**`;

        const embed = new EmbedBuilder()
          .setTitle(`🎂 ${targetUser.displayName}'s Birthday`)
          .setDescription(description)
          .setColor(0xffd700)
          .setThumbnail(targetUser.displayAvatarURL({ size: 64 }));

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.editReply({ embeds: [errorEmbed(err.message)] });
        return;
      }
      log.error({ err }, "Unhandled error in /birthday");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
