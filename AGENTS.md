# AGENTS.md — DragonBot v3

> This file provides context for AI coding assistants (Claude, Copilot, Cursor, etc.) working on this codebase. Architecture sections were remapped against the code on 2026-11-03.

## What Is This Project

DragonBot is a multi-guild Discord bot for university communities. It provides email verification, moderation tools, a honeypot trap channel, user profiles, AI Q&A, XP/leveling, polls, feature suggestions, YouTube upload notifications, scheduled messages, birthday tracking, audit logging, and a Next.js web dashboard.

**Key design constraint:** The bot is fully configurable per-guild. There are zero hardcoded guild, channel, or role IDs anywhere in the codebase. All server-specific settings live in the `guilds` database table and are managed exclusively via the **web dashboard**. Bot commands are read-only or operational — they do not modify guild settings. (`/admin managers-*` writes `guild_admins`, and the bot itself writes a few bot-managed `guilds` columns: honeypot warning IDs, `last_birthday_check_date`, and `is_ban_sync_enabled = false` when it leaves a server.)

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces (`pnpm@10.30.3`)
- **Language:** TypeScript (ESM, `"type": "module"`, strict mode)
- **Bot:** discord.js 14, run from TypeScript source with `tsx` (no build step)
- **Database:** Neon (PostgreSQL) via Drizzle ORM (UUID primary keys). Bot uses `postgres-js`, web uses the Neon HTTP driver.
- **Email:** Resend
- **AI:** OpenAI SDK (Responses API with the `web_search_preview` tool)
- **Web:** Next.js 16 (App Router) + React 19 + Tailwind CSS v4
- **Auth:** Bot-generated one-time token → web signs a JWT (jose, HS256, 24h) into an httpOnly cookie
- **Logging:** pino (structured JSON) in the bot
- **Validation:** zod
- **Scheduling:** node-cron
- **Testing:** Vitest (bot only; the web app has no tests)

## Project Structure

```
apps/bot/                 Discord bot (Railway)
apps/web/                 Next.js dashboard (Vercel; apps/web/vercel.json)
packages/db/              Shared Drizzle schema, clients, permission and honeypot helpers (@dragonbot/db)
docs/superpowers/         Design specs and plans (honeypot)
railway.json              Bot deploy config
turbo.json, tsconfig.base.json, .env.example
pnpm-workspace.yaml       Lists apps/*, packages/* and scripts (no scripts/ directory exists)
```

### apps/bot/src

| Path | Contents |
|---|---|
| `index.ts` | Composition root: loads repo-root `.env`, config, logger, DB, repositories, services, `BotContext`, loader, `clientReady` startup, 4-hour timer, shutdown and crash handlers |
| `client.ts` | `createClient()`: intents and partials |
| `config.ts` | zod env schema, `loadConfig()`, `AppConfig` |
| `loader.ts` | `loadCommands`, `registerCommands`, `loadEvents`, `bindInteractionHandler` |
| `types/` | `commands.ts` (`BotCommand`, `BotEvent`), `context.ts` (`BotContext`), `errors.ts` (`ErrorCode`, `AppError`) |
| `commands/` | 19 slash commands, one default export per file (inventory below) |
| `events/` | 11 gateway event handlers, one default export per file (inventory below) |
| `services/` | 13 services (business logic; table below) |
| `repositories/` | 11 thin Drizzle wrappers (table below) |
| `lib/` | Long-lived runtime components and SDK wrappers (table below) |
| `utils/` | Stateless helpers plus `TTLCache` (table below) |

**Services**

| File | Role | Depends on |
|---|---|---|
| `auth.service.ts` | `generateToken` (32 random bytes hex, 5-min expiry) for `/login`. The web app exchanges the token and signs the JWT | AuthRepository |
| `birthday.service.ts` | Set/remove/view birthdays, upcoming list, formatting, announcement template (`{user}`, `{age}`) | BirthdayRepository |
| `guild-admin.service.ts` | `hasPermission` (`*` or scope), `hasAnyPermission`, manager CRUD validated against `PERMISSION_SCOPES`; 24h `TTLCache` | GuildAdminRepository |
| `guild.service.ts` | Guild settings cache: `hydrateAll`, `getSettings` (cache), `getSettingsFresh` (DB), `ensureGuild`, `updateSettings`, `getAllCached`, `getAllBanSyncGuilds`, `disableBanSync`, `setHoneypotWarning`, `invalidateCache`; 24h `TTLCache` with a write-mark guard so an in-flight read can't re-cache a stale row | GuildRepository |
| `honeypot.service.ts` | In-memory honeypot state (cases, action records, late window, own-deletion marks, per-key mutex, shutdown drain) plus pure helpers (`decideHoneypot`, `isHoneypotReason`, `isHoneypotKickReason`, `warningText`) and constants. No Discord calls | TTLCache |
| `logging.service.ts` | `shouldLog(guildId, LogEventType)`, `sendLogEmbed`, `sendNotice` (ignores event toggles) | GuildService, **discord.js**, `utils/guild-channel` |
| `moderation.service.ts` | `syncBan`: ban in every other ban-sync server; disables sync on Unknown Guild | GuildService, **discord.js** |
| `scheduled-message.service.ts` | `listByGuild`, `getAllEnabled`, `getById`, `updateLastRun`, `cronToHuman` (create/update/toggle/remove/`parseIntervalToCron` exist but are unused: the web writes the table) | ScheduledMessageRepository |
| `suggestion.service.ts` | `create` (checks `is_suggestions_enabled`) | SuggestionRepository, GuildRepository |
| `user.service.ts` | `getProfile`, `isVerified` (24h cache), `markBanned` | UserRepository |
| `verification.service.ts` | `initiateVerification`, `confirmVerification`; domain allowlist, 6 hex-char code (`randomBytes(3)`), 30-min expiry, timing-safe compare | VerificationRepository, GuildRepository, UserRepository, EmailService |
| `xp.service.ts` | In-memory XP engine: `hydrate`, `processMessage`, `getRank`, `getLeaderboard`, snapshot/reset/rehydrate for archives, `flush` (500-row chunks, `isFlushing` guard; a per-entry `version` keeps entries changed mid-flush dirty). `processMessage` returns null until `hydrate()` finishes | XpRepository, logger, `utils/xp` |
| `youtube.service.ts` | `fetchRecentVideos` (Atom RSS via fast-xml-parser, 10s timeout), `buildNotificationMessage` | none |

**Repositories** (one per table unless noted): `auth` (auth_tokens), `birthday` (users birth columns), `guild-admin` (guild_admins), `guild` (guilds), `scheduled-message` (scheduled_messages), `suggestion` (suggestions), `user` (users), `verification` (verifications), `xp` (user_xp, `batchUpsert` uses `sql\`excluded.*\``), `xp-archive` (xp_archives, no service), `youtube` (youtube_subscriptions joined to guilds, no service).

**lib/:** `logger.ts` (pino factory; reads `LOG_LEVEL`, `NODE_ENV` directly), `email.ts` (`EmailService`, Resend), `openai.ts` (`AIService.ask(question, systemPrompt?)`), `scheduler.ts` (`SchedulerManager`: node-cron jobs; `loadAll`, `reload()` full diff with no guild argument, `testJob`, `activeJobCount`), `webhook-server.ts` (`startWebhookServer`, `node:http`), `birthday-checker.ts` (`BirthdayChecker.check()`), `youtube-checker.ts` (`YouTubeChecker.check()`), `honeypot-enforcer.ts` (`handleHoneypotMessage`, `deleteLateMessage`, `sweepCachedMessages`), `honeypot-warning.ts` (`HoneypotWarningSync` `sync`/`syncAll`, `buildWarningEmbed`).

**utils/:** `audit-log.ts` (`findRecentAuditLogEntry`, `resolveBanReason`, `normalizeReason`: kick/ban detection), `cache.ts` (`TTLCache<T>`, 60s unref'd cleanup), `embeds.ts` (`successEmbed`, `errorEmbed`, `infoEmbed`, `logEmbed`, colours), `guild-channel.ts` (`fetchGuildTextChannel`; see Security), `intro-validator.ts` (`validateIntroduction`, 5 gates), `message-log.ts` (`buildMessageDeletedEmbed`, shared by `messageDelete` and the honeypot), `xp.ts` (MEE6 level math, `progressBar`). `course.ts` and `time.ts` have no importers.

### apps/web/src

| Path | Contents |
|---|---|
| `middleware.ts` | CSRF Origin check and per-IP rate limits for `/api/*` |
| `lib/env.ts` | Lazy zod-validated `env` Proxy |
| `lib/db.ts` | Lazy `db` Proxy over `createServerlessClient` |
| `lib/auth.ts` | `signJwt`, `verifyJwt`, `getDiscordIdFromRequest` (no revocation check), `getAuthenticatedUser` (checks `users.jwt_invalid_before`), session cookie helpers |
| `lib/discord.ts` | Discord REST v10 with the bot token: `checkGuildPermission`, `getUserGuildPermissions`, `isGuildMember`, `getDiscordUser`, `resolveDiscordUsers` (10-min cache), `getGuildIconUrl`; `createDiscordLookupMemo()` gives a per-request `DiscordLookupMemo` (successful guild and member lookups only, never kept across requests) that the permission, membership and icon calls accept |
| `lib/bot-webhook.ts` | `notifyBotReload(guildId)`: fire-and-forget POST to the bot |
| `lib/rate-limit.ts` | `isRateLimited` (fixed window, in-memory per instance) |
| `lib/validators.ts` | `DISCORD_SNOWFLAKE_RE`, `cronExpressionSchema`, `embedColorSchema`, `profileUpdateSchema`, `guildSettingsUpdateSchema` |
| `lib/route-guard.ts` | Guild route guard: `authenticateGuildRequest` (401, then 404 for a bad snowflake or UUID param), `requireGuildAccess` (adds the 403 permission check), per-route frozen error bodies (`FEATURE_ROUTE_BODIES`, `SETTINGS_ROUTE_BODIES`, `DISCORD_ROUTE_BODIES`; routes differ on purpose), `invalidDataResponse` (400 zod body) |
| `lib/safe-rows.ts` | `toSafeGuild`, `toSafeUser`: denylists that strip server-only columns before a row is sent to the browser; add each new sensitive column here |
| `app/api/**/route.ts` | API routes (table below) |
| `app/page.tsx`, `app/oauth/page.tsx` | Landing page; token exchange page |
| `app/dashboard/layout.tsx` | Sidebar shell (`GET /api/guilds`, `GET /api/auth`) |
| `app/dashboard/profile/page.tsx` | Profile editor |
| `app/dashboard/server/[guildId]/` | `page.tsx` (settings), `schedules/`, `suggestions/`, `youtube/`, `leaderboard/` |
| `app/leaderboard/[guildId]/page.tsx` | Public leaderboard |
| `components/cron-builder.tsx` | `CronBuilder` (single / multiple / advanced modes); the only shared component |

### packages/db/src

- `schema.ts` — all tables, `GuildRow`
- `client.ts` — `createBotClient(url)` (postgres-js), `DrizzleClient`; logs every query with `console.log`
- `serverless.ts` — `createServerlessClient(url)` (neon-http, no transactions); subpath `@dragonbot/db/serverless`
- `permissions.ts` — `PERMISSION_SCOPES`, `PermissionScope`, `FIELD_SCOPE_MAP`, `grantsScope`, `requiredScopesForFields`, `missingScopes`; subpath `@dragonbot/db/permissions`
- `honeypot.ts` — `HONEYPOT_ACTIONS`, `HoneypotAction`, `HONEYPOT_CONFLICT_FIELDS`, `findHoneypotChannelConflict`; subpath `@dragonbot/db/honeypot`
- `contracts.ts` — `LOG_EVENTS`/`LogEventType`, `SUGGESTION_STATUSES`/`SuggestionStatus`, `DISCORD_SNOWFLAKE_RE`, `UUID_RE`, `YOUTUBE_CHANNEL_ID_RE`; subpath `@dragonbot/db/contracts`
- `logger.ts` — `NeonActivityLogger` (Drizzle logger shared by both clients; not in the barrel)
- `index.ts` — barrel of all of the above

The package ships TypeScript source (`exports` point at `src/*.ts`; web uses `transpilePackages`). `drizzle.config.ts` loads the repo-root `.env`. No `drizzle/` migrations directory is committed.

### Tests

`apps/bot/tests/` mirrors `src/`: `commands/` (suggest), `db/` (honeypot helpers and `FIELD_SCOPE_MAP`), `events/` (guild-ban-add, guild-create, guild-member-add, guild-member-remove, message-delete, message-delete-bulk), `lib/` (birthday-checker, honeypot-enforcer, honeypot-warning, scheduler, youtube-checker), `services/` (guild, honeypot, logging, moderation), `utils/` (audit-log, guild-channel, intro-validator, message-log). No vitest config file. No web or repository tests.

## Commands

```bash
pnpm install                              # Install all workspace deps
pnpm dev                                  # Run bot + web concurrently
pnpm --filter bot dev                     # Bot only (tsx watch)
pnpm --filter web dev                     # Web only (port 3000)
pnpm --filter @dragonbot/db db:push       # Push schema to Neon (db:generate, db:migrate, db:studio also exist)
pnpm build                                # Build all packages (bot and db builds are echo stubs)
pnpm typecheck                            # tsc --noEmit across workspace
pnpm test                                 # Vitest across workspace (only the bot has tests)
# pnpm lint runs turbo lint, but no package defines a lint script
```

## Architecture

### Layered Design

```
Command / Event Handler    (thin controller — parse input, call service, format response)
         ↓
     Service Layer         (business logic, orchestration, validation)
         ↓
    Repository Layer       (database queries only — no business logic)
         ↓
      Drizzle ORM          (schema, typed queries)

lib/   long-lived components (checkers, scheduler, webhook server, honeypot enforcer/warning, SDK wrappers).
       Wired in index.ts, take services by constructor, may import discord.js.
utils/ stateless helpers, imported by any layer; never import services or lib.
```

**Rules:**
- Commands and event handlers **never** import from `repositories/` directly.
- Services **never** import from `discord.js` — they receive plain data and return plain data.
- Repositories are thin wrappers around Drizzle queries — no business logic, no validation.
- This separation means services are testable without mocking Discord.

**Known exceptions (existing code, not precedent):**
- `commands/xp-admin.ts` calls `ctx.xpArchiveRepo` (an `XpArchiveRepository` on `BotContext`; there is no archive service).
- `lib/youtube-checker.ts` uses `YouTubeRepository` directly (YouTubeService has no repository).
- `services/logging.service.ts` and `services/moderation.service.ts` import `discord.js` (they send embeds and bans).
- `SuggestionService` and `VerificationService` read `GuildRepository` directly, bypassing the GuildService cache.
- `commands/schedule.ts` imports the pure `cronToHuman` from the service module.

### BotContext (Dependency Injection)

Built once in `index.ts` (manual constructor wiring, no container) and passed to every command and event handler. From `apps/bot/src/types/context.ts`:

```typescript
export interface BotContext {
  db: DrizzleClient;
  logger: Logger;
  email: EmailService;
  ai: AIService;
  config: AppConfig;
  services: {
    user: UserService;
    guild: GuildService;
    verification: VerificationService;
    auth: AuthService;
    suggestion: SuggestionService;
    moderation: ModerationService;
    logging: LoggingService;
    guildAdmin: GuildAdminService;
    scheduledMessage: ScheduledMessageService;
    xp: XpService;
    birthday: BirthdayService;
    youtube: YouTubeService;
    honeypot: HoneypotService;
  };
  xpArchiveRepo?: XpArchiveRepository;
  scheduler?: SchedulerManager;
  birthdayChecker?: BirthdayChecker;
  youtubeChecker?: YouTubeChecker;
  honeypotWarning?: HoneypotWarningSync;
}
```

- `xpArchiveRepo` is set at construction (optional only in the type).
- `scheduler`, `birthdayChecker`, `youtubeChecker`, `honeypotWarning` are assigned inside `clientReady`; events firing before then must optional-chain them.
- `ctx.db` is not read outside `index.ts`; code reaches the DB through services.

### Command Interface

From `apps/bot/src/types/commands.ts`:

```typescript
export interface BotCommand {
  data: SharedSlashCommand;
  /** If true, deferReply will use ephemeral: true (for commands that show sensitive info) */
  ephemeral?: boolean;
  /** If true, skip the global auto-defer (for commands that reply instantly without DB calls) */
  skipDefer?: boolean;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void>;
}
```

### Event Interface

```typescript
export interface BotEvent<E extends string = string> {
  name: E;
  once?: boolean;
  execute(...args: [...unknown[], BotContext]): Promise<void>;
}
```

Argument types are not checked against `ClientEvents`; each handler declares its own parameter types.

### Loader (`loader.ts`)

- **Discovery:** `readdir` of `src/commands/` and `src/events/` (flat, no recursion); every `.ts` or `.js` file is dynamically imported. A file without `default.data.name` (commands) or `default.name` (events) is skipped with a warning. New files are picked up on restart.
- **Registration:** `registerCommands` PUTs every command **globally** (`Routes.applicationCommands`) on every startup. There is no guild-scoped registration.
- **Auto-defer:** for chat-input commands, unless `skipDefer`, the loader calls `deferReply()` (ephemeral if `command.ephemeral`) before `execute()`. Deferred handlers must use `interaction.editReply()`; `reply()` after a defer throws `InteractionAlreadyReplied`. `skipDefer` commands (`latex`, `mod`, `poll`, `roll`) must use `interaction.reply()`.
- **Command errors:** caught centrally, logged with a child logger `{command, guildId, userId}`, and the user gets the plain ephemeral text "Something went wrong. Please try again later." (via `followUp` if replied/deferred, else `reply`). The loader does not inspect `AppError`; commands map `AppError` to `errorEmbed(err.message)` themselves.
- **Events:** each handler is wrapped in `safeHandler`, which calls `event.execute(...args, ctx)` with **ctx appended as the last argument** and logs rejected promises ("Unhandled error in event handler"). `once` uses `client.once`.
- **Modals:** submits route by `customId.split(":")[0]` to `command.modal`; errors are only logged. No command implements `modal` today. Buttons, select menus, autocomplete and context menus are not routed.

### Error Handling

Custom `AppError` class with typed error codes (`types/errors.ts`). Services throw `AppError`; command handlers catch and map to user-facing embeds.

```typescript
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); this.name = "AppError"; }
}
```

**Never swallow errors.** Unhandled errors are logged with full context via pino, and the user receives the generic ephemeral text above.

### Gateway Intents and Partials (`client.ts`)

- Intents: `Guilds`, `GuildMembers` (privileged), `GuildMessages`, `GuildBans`, `GuildVoiceStates`, `MessageContent` (privileged). Both privileged intents must be enabled in the Discord developer portal.
- Partials: `Message`, `Channel`, `GuildMember`.

### Event Inventory (`src/events/`)

| File | Event | What it does | Log keys |
|---|---|---|---|
| `guild-ban-add.ts` | guildBanAdd | Reads honeypot record first; `markBanned`; "Member Banned" log; `moderation.syncBan` (skipped for honeypot reasons) | `ban` |
| `guild-create.ts` | guildCreate | `ensureGuild`; `honeypotWarning.sync` | — |
| `guild-delete.ts` | guildDelete | Outage (`available === false`): warn only. Removed: `disableBanSync` | — |
| `guild-member-add.ts` | guildMemberAdd | Verification role sync, welcome message, DM welcome, "Member Joined" log | `member_join` |
| `guild-member-remove.ts` | guildMemberRemove | Honeypot record check; kick detection (record or audit log); "Member Left"/"Member Kicked" and a separate "Kick" log | `member_leave`, `kick` |
| `guild-member-update.ts` | guildMemberUpdate | Role and nickname change logs | `role_change`, `nickname_change` |
| `message-create.ts` | messageCreate | Ignores bots and DMs; honeypot (`handleHoneypotMessage`), late-message deletion, intro gate, then XP and level-up embed | — |
| `message-delete.ts` | messageDelete | Skips own/honeypot deletions; resyncs a deleted honeypot warning; deleted-message log | `message_delete` |
| `message-delete-bulk.ts` | messageDeleteBulk | Resyncs the honeypot warning if it was purged | — |
| `message-update.ts` | messageUpdate | Edited-message log | `message_edit` |
| `voice-state-update.ts` | voiceStateUpdate | Join/leave/switch log | `voice_activity` |

Settings come from the GuildService cache (`getSettings`), except the honeypot paths that re-read the DB (`getSettingsFresh`).

### Command Inventory (`src/commands/`)

| Command | Subcommands | Defer | Permission enforced | Notes |
|---|---|---|---|---|
| `/admin` | view-settings, managers-add/remove/list/update, reload | ephemeral | Handler: Manage Server, else `managers` scope (managers-*) or any scope (view-settings, reload). Non-Manage-Server callers grant only scopes they hold; `*` only by `*` holders | Read-only for settings; reload rehydrates guilds, scheduler, honeypot warning |
| `/xp-admin` | flush, reset, status, reset-all, restore, archives | ephemeral | Handler: Manage Server or `xp` scope; reset-all and restore also need Administrator | Flush has a 5-min process-wide cooldown; uses `ctx.xpArchiveRepo` |
| `/schedule` | list, test | ephemeral | Discord default: Manage Server only | Create/edit/delete are web-only |
| `/mod` | talk, react | skipDefer | Discord default: Kick Members only | |
| `/verify` | email, code, sync | ephemeral | — | |
| `/login` | — | ephemeral | — | `{WEBAPP_URL}/oauth?token=…` |
| `/help` | — | ephemeral | Role-aware listing (Kick Members, Manage Server, any guild_admins row) | Hand-maintained text |
| `/birthday` | set, remove, view | ephemeral | — | Global per user |
| `/ask` | — | normal | Requires verification and `is_ask_enabled` | OpenAI |
| `/suggest` | — | normal | Service checks `is_suggestions_enabled` | Posts to `mod_notes_channel_id` with reactions |
| `/whois` | — | normal | — | DMs the looked-up user |
| `/rank`, `/leaderboard` | — | normal | Requires `is_xp_enabled` | Served from memory; leaderboard links to the web |
| `/next-birthdays` | — | normal | Requires `is_birthday_enabled` | Fetches all members |
| `/membercount`, `/offtopic` | — | normal | — | |
| `/poll`, `/latex`, `/roll` | — | skipDefer | — | |

`/help` (`commands/help.ts`) and the README command table are **hand-maintained**; neither is generated from the loaded commands.

### Startup Sequence (`index.ts`)

1. `dotenv` loads the repo-root `.env`; `loadConfig()` (zod; exits on invalid); `createLogger()`.
2. `createBotClient(DATABASE_URL)`; `EmailService`, `AIService`; repositories; services; `BotContext`.
3. `createClient()`; `loadCommands` → `registerCommands` (global REST PUT) → `loadEvents` → `bindInteractionHandler`.
4. `client.login()`, then SIGTERM/SIGINT/crash handlers are registered.
5. `clientReady` (once), in order: `guildService.hydrateAll()` → `xpService.hydrate()` → `SchedulerManager.loadAll()` (→ `ctx.scheduler`) → create `BirthdayChecker`, `YouTubeChecker` and `HoneypotWarningSync` → start the webhook server **only if `BOT_WEBHOOK_SECRET` is set** → start the 4-hour timer → `birthdayChecker.check()` → `youtubeChecker.check()` → `honeypotWarning.syncAll()` (last, in its own try/catch). The webhook server and timer start before the slow checks so dashboard reloads work during startup.

A rejection elsewhere in `clientReady` reaches the `unhandledRejection` handler, which flushes XP and exits 1.

**4-hour sync timer** (one `setInterval`, unref'd): `xpService.flush()` → `guildService.hydrateAll()` → `scheduler.reload()` → `birthdayChecker.check()` → `youtubeChecker.check()` (one try/catch), then `honeypotWarning.syncAll()` in its own try/catch. Birthdays and YouTube have no timer of their own.

**Shutdown** (SIGTERM/SIGINT): 8-second hard-exit deadline → `honeypotService.drain(5000)` → `client.destroy()` → `xpService.flush()` → exit 0. `uncaughtException` / `unhandledRejection`: flush XP, exit 1.

### Bot Webhook Server (`lib/webhook-server.ts`)

Started on `BOT_WEBHOOK_PORT` (default 3001) only when `BOT_WEBHOOK_SECRET` is set. Without it, dashboard changes reach the bot only at the next 4-hour sync or `/admin reload`.

- `GET /health` — unauthenticated, `{status:"ok"}`.
- `POST /webhook/reload[?guildId=][&scope=settings]` — `Authorization: Bearer <secret>` (timing-safe). `scope=settings` skips the scheduler reload; no caller sends it yet (`notifyBotReload(guildId, scope?)`). With a valid snowflake: `invalidateCache` + `getSettings` for that guild; without: `hydrateAll()`. Then a **full** `scheduler.reload()` (skipped only for `scope=settings`), then (not awaited) `honeypotWarning.sync(guildId, {resetBudget:true})` or `syncAll()`.
- `POST /webhook/reload` errors: 400 `{error:"Invalid guildId format"}` when `guildId` is present but fails `/^[0-9]{17,20}$/`; 500 `{error:"Internal error"}` if the reload throws. Success is 200 `{success:true}`.
- The Bearer check runs before method/path routing: any request other than `GET /health` without a valid secret gets 401 `{error:"Unauthorized"}`, even for unknown paths. Only an authenticated request to an unknown route gets 404.

### In-Memory State

The bot is a single process and holds state in memory: guild settings (GuildService, hydrated at ready and every 4h), guild_admins and verified flags (24h `TTLCache`, invalidated on write), all XP rows (XpService), cron jobs (SchedulerManager), and honeypot state (HoneypotService, HoneypotWarningSync). Running two bot instances would split this state.

## Database

PostgreSQL on Neon. Schema defined in `packages/db/src/schema.ts`. The bot imports `@dragonbot/db`; the web imports only subpaths (`@dragonbot/db/schema`, `/permissions`, `/honeypot`, `/contracts`, and `/serverless` for its client), so it never loads the postgres-js client.

### Tables

| Table | Purpose and notable columns |
|---|---|
| `users` | Discord users: `discord_id` (unique), `email`, `is_verified`, `verified_at`, `is_banned`, `ban_guild_id`, `banned_at`, `is_profile_disabled`, `jwt_invalid_before` (JWT revocation), profile (`name`, `pronouns`, `major`, `college`, `year`, `plan`, `description`, `coop1-3`, `clubs[]`), birthday (`birth_month`, `birth_day`, `birth_year`, global per user) |
| `guilds` | All per-server configuration (next section); `guild_id` unique, `guild_name` |
| `guild_admins` | Delegated managers: `guild_id`, `discord_id`, `permissions[]`, `added_by`. Unique `(guild_id, discord_id)` |
| `scheduled_messages` | `channel_id`, `message`, `cron_expression`, `timezone` (default America/New_York), `is_enabled`, `is_embed`, `embed_color`, `embed_title`, `last_run_at`, `next_run_at`, `created_by` |
| `verifications` | Pending codes: `discord_id`, `guild_id`, `email`, `code` (6 hex chars), `expires_at` (30 min) |
| `suggestions` | `discord_id`, `discord_username`, `suggestion`, `status` (free text: `pending`, `approved`, `rejected`, `completed`, `archived`) |
| `sync_flags` | Legacy and unused: nothing reads or writes it (`lib/sync.ts` was removed); kept in the schema so `db:push` does not drop the table |
| `auth_tokens` | One-time login tokens: `token` (64 hex, unique), `command_interaction_id`, `used`, `expires_at` (5 min) |
| `user_xp` | `total_xp`, `level`, `message_count`, `xp_message_count`, `last_message_at`. Unique `(guild_id, discord_id)`; index `(guild_id, total_xp)` |
| `xp_archives` | `archived_by`, `reason`, `data` (jsonb snapshot), `user_count`, `total_xp_sum`, `restored_at`. Index on `guild_id` |
| `youtube_subscriptions` | `youtube_channel_id`, `youtube_channel_name`, `notify_channel_id`, `custom_message`, `last_video_id`, `is_enabled`. Unique `(guild_id, youtube_channel_id)` |

### Key Patterns

- All tables use UUID primary keys (`uuid("id").primaryKey().defaultRandom()`). There are no foreign keys.
- Use `discord_id` / `guild_id` (varchar 20) as the logical unique key.
- Most content fields use `text` type (not varchar) — length validation happens in the application layer via zod.
- **Always upsert.** If a user or guild row doesn't exist, create it with sensible defaults.
- Repositories return Drizzle row types (some with `as` casts), never untyped results.
- All timestamps are `timestamp with time zone`.
- Schema changes go out with `db:push` (no committed migrations). Push new columns **before** the code that reads them ships: `select().from(guilds)` names every column.

### Per-Guild Configuration (guilds table)

**None of these are environment variables.** All live in the database.

| Category | Columns |
|---|---|
| Verification | `verification_role_id`, `is_verification_sync_enabled` (default true) |
| Ban Sync | `is_ban_sync_enabled` |
| Honeypot | `is_honeypot_enabled`, `honeypot_channel_id`, `honeypot_action` (`kick` or `ban`, default `kick`), `honeypot_warning_channel_id`, `honeypot_warning_message_id` (the last two are written only by the bot) |
| Welcome | `welcome_channel_id`, `welcome_message`, `is_welcome_enabled`, `dm_welcome_message`, `is_dm_welcome_enabled` |
| Logging | `log_channel_id`, `is_logging_enabled`, `log_events[]` (`member_join`, `member_leave`, `message_delete`, `message_edit`, `role_change`, `nickname_change`, `voice_activity`, `kick`, `ban`) |
| Intro Gate | `intro_channel_id`, `intro_role_id`, `is_intro_gate_enabled`, `intro_min_chars` (24), `intro_min_words` (5), `intro_min_substantive_words` (3), `intro_unique_word_ratio` (50), `intro_max_repeated_char_pct` (50) |
| Mod Notes | `mod_notes_channel_id` |
| Suggestions | `is_suggestions_enabled` (default true) |
| AI / Ask | `is_ask_enabled` (default true), `ask_system_prompt` |
| Off-Topic | `offtopic_images[]`, `offtopic_message` |
| XP / Leveling | `is_xp_enabled`, `xp_min` (15), `xp_max` (25), `xp_cooldown_seconds` (60), `xp_levelup_channel_id`, `xp_excluded_channel_ids[]`, `xp_excluded_role_ids[]` |
| Birthdays | `is_birthday_enabled`, `birthday_channel_id`, `birthday_role_id`, `birthday_message`, `birthday_timezone` (default America/New_York), `last_birthday_check_date` (bot-managed) |
| YouTube | `is_youtube_enabled` |

When a setting is null or a feature toggle is false, the feature is simply inactive — no errors, no fallback.

## Permissions Model

`packages/db/src/permissions.ts` defines the delegated scopes:

`verification`, `welcome`, `logging`, `intro_gate`, `moderation`, `suggestions`, `ai`, `offtopic`, `xp`, `schedules`, `birthday`, `youtube`, `managers`, `*` (wildcard)

The server owner and members with Administrator or Manage Server always get full access (`checkDiscordManageGuild` in `apps/web/src/lib/discord.ts`; timed-out members keep only Administrator). The `guild_admins` table is additive.

The honeypot fields (`is_honeypot_enabled`, `honeypot_channel_id`, `honeypot_action`) need full access: the server owner, Administrator, Manage Server or a `guild_admins` row holding `*`. They decide who gets kicked or banned, so the `moderation` scope isn't enough.

**Who enforces what:**

| Surface | Check |
|---|---|
| Web `PATCH /api/server/[guildId]` | `getUserGuildPermissions` → each field's scope from `FIELD_SCOPE_MAP` (`*` passes all). Fields absent from the map need no scope |
| Web schedules, suggestions and YouTube **writes** (POST, PATCH, DELETE, `youtube/resolve`) | `checkGuildPermission(guildId, userId, scope)` with `schedules`, `suggestions` or `youtube` |
| Web GET routes (settings, schedules, suggestions, YouTube, Discord data) | `checkGuildPermission(guildId, userId)` with **no scope**: any `guild_admins` row with at least one scope can read |
| Web `GET /api/server/[guildId]/leaderboard` | Guild membership only (`isGuildMember`) |
| Bot `/admin` | `managers` scope for managers-*, any scope for view-settings/reload |
| Bot `/xp-admin` | `xp` scope (Administrator for reset-all/restore) |
| Bot `/schedule`, `/mod` | Discord default member permissions only |

## Environment Variables

Infrastructure secrets only. **No guild-specific values.** Both apps read the repo-root `.env` in development.

**Bot** (`apps/bot/src/config.ts`, zod, exits on failure):

```env
DISCORD_API_TOKEN=        # Bot token
BOT_CLIENT_ID=            # Application ID for command registration
DATABASE_URL=             # Neon connection string (URL)
RESEND_API_KEY=           # Resend API key
RESEND_FROM_EMAIL=        # Sender address for verification emails (email)
OPENAI_API_KEY=           # OpenAI key
OPENAI_MODEL=gpt-5-mini   # Default model
WEBAPP_URL=               # e.g. https://app.drexeldiscord.com (URL; used in /login, /help, /admin, /schedule, /leaderboard)
BOT_WEBHOOK_SECRET=       # Optional, min 16 chars; webhook server starts only when set
BOT_WEBHOOK_PORT=3001     # 1-65535, default 3001 (leave unset rather than blank)
```

Read outside zod by `lib/logger.ts`: `LOG_LEVEL` (default `info`), `NODE_ENV` (`development` enables the pino file transport to stdout).

**Web** (`apps/web/src/lib/env.ts`, zod, validated lazily on first access; throws on failure):

```env
DATABASE_URL=             # Required
JWT_SECRET=               # Required, min 32 chars; signs and verifies session JWTs
DISCORD_API_TOKEN=        # Required; bot token for Discord REST permission checks
BOT_WEBHOOK_URL=          # Optional URL: the bot's origin, e.g. http://localhost:3001 (code appends /webhook/reload)
BOT_WEBHOOK_SECRET=       # Optional, min 16; must equal the bot's. Webhook calls are skipped unless both are set
```

`NODE_ENV` also selects the CSP in `next.config.ts` and the cookie `Secure` flag; outside production `env.ts` loads `../../.env` with `require("dotenv")`.

## Web Dashboard

### Auth Flow

1. `/login` in Discord → `AuthService.generateToken()` → stores in `auth_tokens` (5-min expiry)
2. Bot replies ephemeral with a button to `{WEBAPP_URL}/oauth?token=<token>`
3. `app/oauth/page.tsx` (guarded against a double run) calls `POST /api/auth`, which validates the 64-hex token, atomically marks it used (`UPDATE … WHERE used = false AND expires_at > now() RETURNING`), deletes expired rows, signs a JWT `{discord_id}` (HS256, 24h), and sets it as the `dragonbot_session` cookie (HttpOnly, SameSite=Lax, Secure in production)
4. The UI calls `/api/*` with `credentials: "same-origin"`; it never stores the JWT. `Authorization: Bearer <jwt>` is accepted as a fallback
5. `getAuthenticatedUser` verifies the JWT, then rejects it if issued before `users.jwt_invalid_before` or if the user row is missing
6. Logout: `DELETE /api/auth` clears the cookie. A 401 on any page redirects to `/`

### Middleware (`src/middleware.ts`, matcher `/api/:path*`)

- **CSRF:** for POST/PATCH/PUT/DELETE, if both `Origin` and `Host` are present, their hosts must match, else 403 `CSRF_REJECTED`.
- **Rate limits:** `POST /api/auth` 10/min per IP; all `/api/*` 60/min per IP. IP is `x-real-ip`, then the first `x-forwarded-for`. Counters are in memory per serverless instance.
- `next.config.ts` adds security headers (CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) to every path.

### API Routes

All `[guildId]` path params are validated against `/^[0-9]{17,20}$/` before any DB access; schedule, suggestion and subscription IDs are validated as UUIDs. Failures return `{ error }`, most also `code`.

| Route | Method | Auth | Permission | Notes |
|---|---|---|---|---|
| `/api/auth` | POST | none (token) | — | Token → cookie |
| `/api/auth` | GET | `getAuthenticatedUser` | — | User info + Discord avatar |
| `/api/auth` | DELETE | `getDiscordIdFromRequest` | — | Clears cookie |
| `/api/guilds` | GET | yes | — | Custom-admin guilds, then up to 20 Discord checks; `isAdmin` false for plain members (leaderboard only) |
| `/api/profile` | GET, PATCH | yes | own row | `profileUpdateSchema`; strips email, ban and JWT fields |
| `/api/server/[guildId]` | GET | yes | any scope | Guild settings |
| `/api/server/[guildId]` | PATCH | yes | per-field `FIELD_SCOPE_MAP` | `guildSettingsUpdateSchema`, xpMin/xpMax cross-check, `findHoneypotChannelConflict`, `notifyBotReload` |
| `/api/server/[guildId]/discord` | GET | yes | any scope | Channels and roles from Discord. Shortcut: a `guild_admins` row for this guild with at least one scope skips the Discord check |
| `/api/server/[guildId]/leaderboard` | GET | yes | guild member | Top 100 from `user_xp`, no pagination |
| `/api/server/[guildId]/schedules` | GET, POST | yes | GET any scope; POST `schedules` | POST: cron validation, `notifyBotReload` |
| `/api/server/[guildId]/schedules/[scheduleId]` | PATCH, DELETE | yes | `schedules` | `notifyBotReload` |
| `/api/server/[guildId]/suggestions` | GET | yes | any scope | List |
| `/api/server/[guildId]/suggestions/[suggestionId]` | PATCH, DELETE | yes | `suggestions` | Status change; DELETE archives |
| `/api/server/[guildId]/youtube` | GET, POST | yes | GET any scope; POST `youtube` | POST: 409 on duplicate, `notifyBotReload` |
| `/api/server/[guildId]/youtube/[subscriptionId]` | PATCH, DELETE | yes | `youtube` | `notifyBotReload` |
| `/api/server/[guildId]/youtube/resolve` | POST | yes | `youtube` | Scrapes youtube.com for channel ID + name |
| `/api/leaderboard/[guildId]` | GET | **none (public)** | — | Top 100 + guild name |

`notifyBotReload` is fire-and-forget; the bot's 4-hour sync is the fallback.

### Web UI

- Every page except `app/layout.tsx` and `app/page.tsx` is a client component that fetches `/api/*` in `useEffect`. **Discord-like dark theme** via Tailwind v4 colours (`dc-bg-primary`, `dc-accent`, … in `globals.css`).
- **Sidebar** (`dashboard/layout.tsx`, responsive): servers from `GET /api/guilds`; admins see Settings, Schedules, YouTube, Suggestions and Leaderboard; members see Leaderboard only.
- **Server settings:** Verification, Welcome, Audit Logging, Intro Gate, Moderation, Honeypot, Suggestions, AI, Off-Topic, XP, Birthdays. Channel/role dropdowns come from Discord; role and channel IDs are sent only when that data loaded. Sticky unsaved-changes bar. `PlaceholderTextarea` (settings page only): contenteditable with channel pills, `{member}/{server}` buttons and `#` autocomplete.
- **Schedules:** create, edit, toggle, delete (confirmation modal); `CronBuilder`; plain textarea for the message. **YouTube:** module toggle (`isYoutubeEnabled` via `PATCH /api/server/[guildId]`), resolve-then-add, per-subscription toggle/edit/delete. **Suggestions:** filter, status, archive. **Profile:** Drexel-specific Year/Plan/College dropdowns and birthday. **Leaderboards:** `/dashboard/server/[guildId]/leaderboard` (members) and public `/leaderboard/[guildId]`.

### Lazy Initialization

The web app uses lazy proxies for `env` and `db` to avoid build-time errors (Vercel builds without env vars):
- `env` — Proxy that validates on first property access, not import
- `db` — Proxy that creates the Drizzle client on first query

## Bot Features

### XP / Leveling

MEE6-style XP with in-memory caching to minimize DB writes (Neon charges for compute time).

- **Startup:** `XpService.hydrate()` loads all `user_xp` rows into memory; messages before it finishes earn no XP
- **Message XP:** Random XP per message (`xp_min`–`xp_max`), per-user cooldown, excluded channels/roles. All in-memory — zero DB writes per message.
- **Level-up:** Announces in `xp_levelup_channel_id` if set
- **`/rank`, `/leaderboard`:** Served entirely from memory
- **Flush:** the 4-hour sync timer calls `xpService.flush()` (dirty entries only, 500-row chunks, `isFlushing` guard). `XpService.startFlushTimer` exists but is not called. `/xp-admin flush` has its own 5-minute process-wide cooldown (`lastFlushAt` in `commands/xp-admin.ts`).
- **Graceful shutdown:** SIGTERM/SIGINT and crash handlers flush before exit
- **Archives (backup/restore):** `/xp-admin reset-all` archives current XP state to `xp_archives` (jsonb snapshot) before zeroing (in memory; the DB catches up on flush). `/xp-admin restore <archive_id>` auto-archives current state first (undo is always possible), then restores. `/xp-admin archives` lists the 10 most recent snapshots.
- **Public leaderboard:** `/api/leaderboard/[guildId]` serves leaderboard data without auth.

### Honeypot

A per-server trap channel for spam waves: DragonBot keeps a pinned warning in it and removes ordinary accounts that post there. Code: `lib/honeypot-enforcer.ts` (message handling), `lib/honeypot-warning.ts` (`HoneypotWarningSync`), `services/honeypot.service.ts` (state and pure helpers), `packages/db/src/honeypot.ts` (shared helpers). The Honeypot card sets the three settings in the config table (full access only: Manage Server or `*`; the action defaults to `kick`). Only the bot writes `honeypot_warning_channel_id` and `honeypot_warning_message_id`; the `PATCH` never accepts them. A *notice* is a message in the log channel.

- **Who triggers what:** `messageCreate` checks the honeypot channel before the intro gate and XP, so a honeypot post earns no XP. System, webhook and bot messages, threads and the System Messages channel are ignored. **Staff** (Administrator, Manage Server, Kick Members or Ban Members, nothing else) are ignored completely. A **verified** member (has `verification_role_id`; none set means nobody is) only has the message deleted and logged. Everyone else is kicked or banned, with the message and their last hour deleted. A failed member lookup removes nobody (it might be staff); an author who left is still removed by ID.
- **No warning, no enforcement:** a post is acted on only if the honeypot is enabled with a channel, the stored warning channel equals it, a warning ID is stored and the post is newer than the warning (pinned isn't required). Before it deletes a honeypot post or removes anyone, it re-reads the row from the database, since the cache can be stale (the late-message deletions and the sweep only follow a removal that passed). The bot refuses to arm in the System Messages channel, in a channel another setting uses (`findHoneypotChannelConflict`), or when the channel's resolved ID differs from the stored string: the sync removes any stored warning, clears the IDs and sends a notice.
- **Kick is a ban plus an unban:** a ban is the only call that cleans up a user's messages server-wide, so both actions ban with `deleteMessageSeconds: 3600` (`CLEANUP_SECONDS`). Ban reasons start with `[Honeypot]` (a kick's with `[Honeypot kick]`). Kick mode checks the ban list first: an already-banned account gets neither ban nor unban (the unban would lift someone else's ban), and an unreadable list removes nobody. A failed unban is retried once, then reported.
- **The warning:** `HoneypotWarningSync` keeps one embed per server, posted and pinned. `messageDelete` and `messageDeleteBulk` start a sync that takes the deleted warning as gone, without fetching it. Reposts share a budget of `MAX_POSTS_PER_WINDOW` (3) per server per `POST_WINDOW_MS` (10 min), across syncs; once spent, nothing is posted, the IDs stay cleared (the honeypot is off) and a notice says so. Only a dashboard save for that server and `/admin reload` reset it.
- **Warning syncs** run after a dashboard save (one server, or all on a full reload), on startup, every 4 hours, on `/admin reload` (that server only), when DragonBot joins a server and when the warning is deleted. Syncs for one server are serialised (`HoneypotService.runExclusive`). A sync reads the row from the database and adopts a warning already pinned rather than posting a duplicate. Unknown Message and Unknown Channel mean gone (IDs replaced or cleared); other failures, such as Missing Access, mean "can't tell" (IDs kept, a notice).
- **One case per account, cleanup and shutdown:** in-flight actions are keyed by server and user (`HoneypotService.beginCase`). A further post from the same account while its case runs (or sent before it ended) is deleted but starts no second action or log entry; a case past `IN_FLIGHT_TIMEOUT_MS` counts as over. Discord's ban cleanup can miss the newest message, so a confirmed ban is followed by a sweep of the account's cached messages (`SWEEP_DELAY_MS`) and, for `LATE_MESSAGE_WINDOW_MS`, deletion of its new ones. `HoneypotService.drain` waits up to 5 seconds before `client.destroy()`; a kick-mode post arriving after shutdown begins is only deleted and logged.
- **Ban sync and the other handlers:** DragonBot records each action in memory before calling Discord (`RECORD_TTL_MS` from when the ban resolves, `UNCERTAIN_RECORD_TTL_MS` when unconfirmed), and `guildBanAdd` and `guildMemberRemove` read it first, before any `await`. Ban sync skips honeypot actions, and any ban whose reason contains `[Honeypot`. A honeypot ban logs "Member Banned" only; a kick logs "Member Kicked" and skips `markBanned` and "Member Banned". With the record gone, `guildBanAdd` still recognises a kick by its `[Honeypot kick]` reason and skips `markBanned`, "Member Banned" and ban sync; that kick's member-remove event then logs "Member Left".
- **Logging and notices:** notices (`LoggingService.sendNotice`) go out whenever logging is enabled with a log channel, and warning-sync notices repeat at most once per server per distinct text every 24 hours. The generic `messageDelete` handler skips messages DragonBot deleted itself, its own warning and messages from an account with a recent honeypot action.
- **Dashboard:** the `PATCH` route rejects a channel another setting uses (`findHoneypotChannelConflict`). The card turns the honeypot on only for a text channel in the loaded list. A save sends each honeypot field only when it differs from the last saved settings (all three when it turns the honeypot on), so a tab left open can't turn the honeypot back on, or put back an old action or channel, on an unrelated save.
- **Permissions and deploy:** `docs/superpowers/specs/2026-10-29-honeypot-design.md` lists the bot permissions (Pin Messages is separate from Manage Messages since 2026-02-23). New `guilds` columns must be pushed before the code that reads them ships, because `select().from(guilds)` names every column.

### YouTube Notifications

RSS-based YouTube upload notifications managed entirely via the web dashboard. No Google API key required.

- **Subscriptions:** Admins add YouTube channels on the YouTube page. `POST /api/server/[guildId]/youtube/resolve` resolves URLs/handles/names to channel IDs by scraping page metadata.
- **`YouTubeChecker`** (`lib/youtube-checker.ts`) runs at startup and on the 4-hour sync timer, guarded against overlapping runs. It loads subscriptions where both `guilds.is_youtube_enabled` and `is_enabled` are true, fetches feeds sequentially and posts to `notify_channel_id` as plain text (Discord auto-embeds).
- **What gets announced:** every video newer than `last_video_id`, oldest first, at most 5 per subscription per check and only videos under 3 days old. A subscription's first check, or a feed that no longer contains `last_video_id`, sets a baseline without announcing. `last_video_id` is updated before announcing (at most once).
- **Custom messages:** Optional template with `{title}`, `{url}`, `{channel}` placeholders. Default: `**{channel}** just uploaded a new video!\n{url}`.
- **Toggles:** `is_youtube_enabled` master switch (on the YouTube page). Individual subscriptions also have `is_enabled`.

### Birthdays

- `/birthday set/remove/view` stores the date on `users` (global per user). `/next-birthdays` lists the next 15 among current members.
- `BirthdayChecker` runs at startup and on the 4-hour timer: for each server with `is_birthday_enabled` and a channel, once it is 9 AM or later in `birthday_timezone` and `last_birthday_check_date` isn't today, it removes `birthday_role_id` from cached holders, assigns it to today's birthdays, posts `birthday_message` (`{user}`, `{age}`), and records the date. Announcements can be up to 4 hours after 9 AM.

### Suggestions

- **`/suggest <suggestion>`:** Creates a `suggestions` entry (fails when `is_suggestions_enabled` is false). If `mod_notes_channel_id` is set, posts an embed there with thumbs-up/thumbs-down reactions.
- **Status workflow:** `pending` → `approved` / `rejected` / `completed` / `archived`. The dashboard filters, changes status and archives/unarchives.

### Polls

`/poll` (`skipDefer`): reaction polls with no database and no dashboard. No options gives thumbs-up/down; up to 20 options with emoji support (Unicode, custom emoji, guild shortcodes, fallback to regional indicators A-T). Deleting the message loses the votes.

### Scheduled Messages

- `SchedulerManager` (`lib/scheduler.ts`) keeps node-cron jobs in memory; content is cached per job, so firing reads no DB row (it writes `last_run_at`).
- On startup: loads all enabled schedules. `scheduler.reload()` (full diff against the DB; no guild argument) runs on the 4-hour timer, on `/admin reload`, and on every webhook reload.
- **Webhook-triggered reload:** schedule routes call `notifyBotReload`, which POSTs `{BOT_WEBHOOK_URL}/webhook/reload?guildId=<id>`. **`BOT_WEBHOOK_URL` must be the bot server's origin (port 3001), not the Next.js app (3000), and must not end in `/webhook`.**
- `/schedule list` and `/schedule test <id>` are the only bot-side commands; creation and editing are web-only.
- Supports plain text and embed messages (color, title).

### Audit Logging

Embeds match the original bot: author header with avatar, structured fields, and an ID code block (`js` highlighting) at the bottom. Handlers call `logging.shouldLog(guildId, key)` then `logging.sendLogEmbed(...)` for the nine `LogEventType` keys listed under the guilds table. A kick can produce two entries (`member_leave` "Member Kicked" and `kick`).

### Verification

- Email verification locked to `drexel.edu` and `dragons.drexel.edu` domains (hardcoded in `VerificationService`)
- Codes are 6 hex characters, 30-min expiry
- Verification syncs across all servers with sync enabled; `/verify sync` applies the role in the current server

### Intro Gate

In `intro_channel_id`, `messageCreate` runs `validateIntroduction` with the five `intro_*` thresholds. A pass assigns `intro_role_id`; a failure deletes the message and DMs the reason with the original text.

## Deployment

- **Bot** → Railway. `railway.json`: Nixpacks, build `pnpm install`, start `cd apps/bot && node --import tsx/esm src/index.ts` (same as `pnpm --filter bot start`), restart on failure up to 10 times. One instance only (in-memory state).
- **Web** → Vercel. `apps/web/vercel.json`: install `cd ../.. && pnpm install`, build `next build`.
- **Database** → Neon (serverless PostgreSQL). Schema via `pnpm --filter @dragonbot/db db:push`, before deploying code that reads new columns.

## Known Gaps (2026-11 audit)

The 2026-11-03 codebase audit lists dead code, duplication, performance issues, layer-rule exceptions and permission gaps (for example `/mod` and `/schedule` relying on Discord default permissions, and unscoped web routes). Findings, severity and proposed fixes are in `docs/audit/2026-11-03-codebase-audit.md`; read it before refactoring and don't restate its findings here.

## Security

### General Principles

- **Never trust user input.** All data from Discord interactions, API request bodies, query params, and path params must be validated with zod before use. Guild IDs, channel IDs, role IDs, and user IDs are validated against `/^[0-9]{17,20}$/`.
- **No raw SQL.** Use Drizzle's query builder exclusively. If raw SQL is unavoidable, use parameterized queries — never interpolate user input into SQL strings.
- **No `eval()`, `Function()`, or dynamic code execution.** Never execute user-supplied strings as code.
- **No secret logging.** Never log tokens, API keys, JWTs, verification codes, or `DATABASE_URL`.

### Authentication & Authorization

- **JWT validation on every authenticated request.** Every API route that reads or writes user/guild data must verify the JWT signature and expiration (use `getAuthenticatedUser`, which also checks revocation).
- **Authorization is not authentication.** After verifying identity via JWT, always check the user has permission for the specific guild/resource (owner, Administrator or Manage Server, guild_admins table entry, or resource ownership).
- **Auth tokens are single-use.** `POST /api/auth` marks the `auth_tokens` row used in the same atomic update that reads it. Never allow reuse.
- **Sensitive data is ephemeral.** Verification codes, login links, and tokens must only appear in ephemeral Discord replies — never in public channels.

### API Endpoint Security

- **Validate all path params before DB queries.** Return 404 `NOT_FOUND` for a malformed `guildId`/UUID (the existing routes do), not a DB error. 400 is for invalid request bodies.
- **Scope all queries to the authenticated user's permissions.** An admin of Guild A must never access Guild B's data.
- **Return generic error messages to clients.** Stack traces, SQL errors, and internal details go to server logs only.
- **No open redirects.** Never construct redirect URLs from user input. `WEBAPP_URL` is validated at startup.

### Webhook Server Security

- **Always verify `BOT_WEBHOOK_SECRET`** in the `Authorization` header. Reject unauthenticated requests. (`GET /health` is the only unauthenticated route.)
- **Validate webhook payloads.** The `guildId` query param must pass snowflake validation before any work.

### Bot-Specific Security

- **Permission checks in commands.** Admin/mod commands must verify Discord permissions or guild_admins status in the handler — never rely solely on Discord's built-in command permissions.
- **AI prompt injection.** The `/ask` command passes user input to OpenAI. System prompts must not contain secrets or internal implementation details. Sanitize or truncate excessively long inputs.
- **Email domain allowlist.** Verification is restricted to `drexel.edu` and `dragons.drexel.edu` in the service layer. Never add wildcard patterns.
- **Settings channels stay in their own server.** Fetch a channel named in a server's settings with `fetchGuildTextChannel` (`apps/bot/src/utils/guild-channel.ts`) or `guild.channels.fetch`, never bare `client.channels.fetch`. Settings hold bare channel IDs, and `client.channels.fetch` finds a channel in any server DragonBot is in, so one server's messages could land in another server's channel.

### Environment & Deployment

- **`.env*.local` must be in `.gitignore`.** Never commit secrets.
- **Env vars are validated with zod.** The bot validates at startup and exits on missing required vars; the web validates on first access and throws. Never fall back to empty strings for secrets. (`LOG_LEVEL` and `NODE_ENV` are read directly.)
- **Run `pnpm audit` periodically** to check for vulnerable dependencies.

### What AI Agents Must NOT Do

When modifying this codebase, AI coding assistants must **never**:

1. **Add unauthenticated endpoints.** Every new API route that reads or writes data must include JWT verification and authorization checks.
2. **Bypass validation.** Never skip zod validation on any input boundary.
3. **Hardcode secrets or tokens.** Always use environment variables — never put API keys, tokens, or passwords in source code.
4. **Add debug/backdoor routes.** Never create `/api/debug`, `/api/test`, `/api/admin-bypass`, or any route that skips authentication — even "temporarily."
5. **Log sensitive data.** Never log tokens, passwords, verification codes, JWTs, or user emails.
6. **Weaken auth checks.** Never make permission checks always return `true`, skip guild ownership verification, or remove webhook secret validation.
7. **Expose internal errors.** Never return raw error messages, stack traces, or SQL errors to API clients.
8. **Add `eval()` or dynamic code execution.** Never use `eval()`, `new Function()`, or execute user-supplied strings as code.
9. **Disable HTTPS or certificate validation.** Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
10. **Add wildcard CORS.** Never set `Access-Control-Allow-Origin: *` on authenticated endpoints.

## Style & Conventions

- TypeScript strict mode, ESM (`"type": "module"` in all package.json files); relative imports use `.js` suffixes in the bot
- `import` / `export` only — never `require` (except in env.ts dev fallback)
- `const` over `let`, never `var`
- Drizzle query builder for all DB access — no raw SQL (the `sql\`excluded.*\`` fragments in `XpRepository.batchUpsert` are the existing exception)
- All interaction replies with sensitive info (tokens, codes) must be **ephemeral**
- Embed colors: success `0x43b581`, error `0xff0000`, info `0xffcc00`, log `0x5865f2` (`utils/embeds.ts`)
- File naming: kebab-case (`guild-member-add.ts`, `user.service.ts`)
- One export per file for commands and events
- All function parameters and return types must be explicitly typed — no `any`
- Prefer early returns over nested if/else
- Every service method that can fail throws `AppError` with a specific `ErrorCode`
- Logging: pino only in the bot — never `console.log`, `console.error`, or `console.warn`. Existing exceptions: `config.ts` and the fatal startup catch in `index.ts` (before pino exists), the query loggers in `packages/db`, and the web app, which has no pino
- Tests live in `apps/bot/tests/` mirroring `src/` structure, named `*.test.ts`
- **Always use `interaction.editReply()`** in command handlers — never `interaction.reply()` — because the loader auto-defers all interactions before calling `execute()`. Exception: commands with `skipDefer: true` (`latex`, `mod`, `poll`, `roll`) must use `interaction.reply()` instead since no defer has occurred.

## How to Add a New Feature

1. **Schema** — Add table/columns to `packages/db/src/schema.ts`, run `db:push` (before shipping code that reads them)
2. **Repository** — Create `apps/bot/src/repositories/my-feature.repository.ts` (thin Drizzle wrapper)
3. **Service** — Create `apps/bot/src/services/my-feature.service.ts` (business logic, throws `AppError`)
4. **Wire up** — Add to `BotContext` in `types/context.ts`, instantiate in `index.ts`
5. **Command** — Create `apps/bot/src/commands/my-feature.ts` (auto-discovered on restart and registered globally), then add it by hand to `/help` (`commands/help.ts`) and the README command table
6. **Events** — Create `apps/bot/src/events/my-event.ts` if needed (auto-discovered; add an intent in `client.ts` if the event needs one)
7. **Web API** — Add routes to `apps/web/src/app/api/...`; new guild settings fields also need an entry in `FIELD_SCOPE_MAP` and `guildSettingsUpdateSchema`
8. **Web UI** — Add pages to `apps/web/src/app/dashboard/...`
9. **Verify** — Run `pnpm typecheck` and `pnpm test`
