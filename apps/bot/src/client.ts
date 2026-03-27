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
        maxSize: 200, // Fetched on demand for /membercount, /whois
      },
      MessageManager: {
        maxSize: 50, // Needed for message edit/delete logs
      },
      UserManager: {
        maxSize: 200,
      },
      // Disable caches we never read
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      ThreadManager: { maxSize: 0 },
      ThreadMemberManager: { maxSize: 0 },
      AutoModerationRuleManager: 0,
      GuildInviteManager: 0,
    }),
    // No sweepers — cache limits already cap memory. Sweepers add timers for minimal gain.
  });
}
