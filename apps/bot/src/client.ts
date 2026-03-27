import { Client, GatewayIntentBits, Partials, Options } from "discord.js";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildBans,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.GuildMember,
    ],
    makeCache: Options.cacheWithLimits({
      // Keep default caches for guilds, channels, roles (needed for commands)
      GuildMemberManager: {
        maxSize: 200, // Only cache 200 members per guild (fetched on demand)
      },
      MessageManager: {
        maxSize: 50, // Only cache last 50 messages per channel (needed for message edit/delete logs)
      },
      UserManager: {
        maxSize: 200, // Limit cached users
      },
      PresenceManager: 0, // Don't cache presences at all (we don't use them)
      ReactionManager: 0, // Don't cache reactions (we read them at delete time)
      ReactionUserManager: 0,
      GuildEmojiManager: 0, // Don't cache emojis
      GuildStickerManager: 0, // Don't cache stickers
      GuildScheduledEventManager: 0, // Don't cache scheduled events
      StageInstanceManager: 0, // Don't cache stage instances
      ThreadManager: {
        maxSize: 0, // Don't cache threads
      },
      ThreadMemberManager: {
        maxSize: 0,
      },
      AutoModerationRuleManager: 0,
      GuildInviteManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300, // Sweep old messages every 5 minutes
        lifetime: 600, // Remove messages older than 10 minutes
      },
      users: {
        interval: 600, // Sweep users every 10 minutes
        filter: () => (user) => !user.bot && user.id !== user.client.user?.id, // Keep bot user, sweep others
      },
      guildMembers: {
        interval: 600,
        filter: () => (member) => !member.user.bot, // Keep bot members, sweep human members
      },
    },
  });
}
