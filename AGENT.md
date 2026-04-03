# AGENT.md — DragonBot v3

> This file provides context for AI coding assistants (Claude, Copilot, Cursor, etc.) working on this codebase.

## What Is This Project

DragonBot is a multi-guild Discord bot for university communities. It provides email verification, moderation tools, user profiles, AI Q&A, XP/leveling, polls, feature suggestions, YouTube upload notifications, scheduled messages, birthday tracking, audit logging, and a Next.js web dashboard.

**Key design constraint:** The bot is fully configurable per-guild. There are zero hardcoded guild, channel, or role IDs anywhere in the codebase. All server-specific settings live in the `guilds` database table and are managed exclusively via the **web dashboard**. Bot commands are read-only or operational — they do not modify guild settings.

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Language:** TypeScript (ESM, `"type": "module"`, strict mode)
- **Bot:** discord.js 14
- **Database:** Neon (PostgreSQL) via Drizzle ORM (UUID primary keys)
- **Email:** Resend
- **AI:** OpenAI SDK
- **Web:** Next.js 16 (App Router) + Tailwind CSS v4
- **Auth:** Bot-generated token → JWT exchange
- **Logging:** pino (structured JSON)
- **Validation:** zod
- **Scheduling:** node-cron
- **Testing:** Vitest

## Project Structure

```
apps/bot/          — Discord bot
apps/web/          — Next.js dashboard
packages/db/       — Shared Drizzle schema + client (imported as @dragonbot/db)
scripts/           — Migration utilities
```

## Commands

```bash
pnpm install                              # Install all workspace deps
pnpm dev                                  # Run bot + web concurrently
pnpm --filter bot dev                     # Bot only
pnpm --filter web dev                     # Web only
pnpm --filter @dragonbot/db db:push       # Push schema to Neon
pnpm build                                # Build all packages
pnpm typecheck                            # tsc --noEmit across workspace
pnpm test                                 # Vitest across workspace
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
```

**Rules:**
- Commands and event handlers **never** import from `repositories/` directly.
- Services **never** import from `discord.js` — they receive plain data and return plain data.
- Repositories are thin wrappers around Drizzle queries — no business logic, no validation.
- This separation means services are testable without mocking Discord.

### BotContext (Dependency Injection)

A `BotContext` object is created at startup and passed to every command and event handler. It contains the database client, logger, and all service instances.

```typescript
interface BotContext {
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
  };
  xpArchiveRepo?: XpArchiveRepository; // present after startup
  scheduler?: SchedulerManager;        // present after startup, absent during early init
  birthdayChecker?: BirthdayChecker;   // present after startup
  youtubeChecker?: YouTubeChecker;     // present after startup
}
```

### Command Interface

```typescript
interface BotCommand {
  data: SlashCommandBuilder;
  ephemeral?: boolean;            // if true, loader defers with ephemeral=true
  skipDefer?: boolean;            // if true, loader skips auto-defer entirely
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void>;
}
```

Commands are auto-loaded from `src/commands/` at startup. The loader reads every `.ts` file, registers slash commands with Discord, and binds the interaction handler.

**Auto-defer pattern:** The loader always calls `interaction.deferReply()` before `execute()` (with `ephemeral: true` if the command sets that flag), unless `skipDefer: true`. This means handlers must **always** use `interaction.editReply()`, never `interaction.reply()`. Using `reply()` after an auto-defer causes a Discord `InteractionAlreadyReplied` error.

### Event Interface

```typescript
interface BotEvent<E extends keyof ClientEvents = keyof ClientEvents> {
  name: E;
  once?: boolean;
  execute(...args: [...ClientEvents[E], BotContext]): Promise<void>;
}
```

Events are auto-loaded from `src/events/` and bound to the client at startup.

### Error Handling

Custom `AppError` class with typed error codes. Services throw `AppError`; command handlers catch and map to user-facing embeds.

```typescript
class AppError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}
```

**Never swallow errors.** Unhandled errors are logged with full context via pino, and the user receives a generic "something went wrong" embed.

## Database

PostgreSQL on Neon. Schema defined in `packages/db/src/schema.ts`. Both apps import from `@dragonbot/db`.

### Tables

- **users** — Discord users, verification status, profile fields (name, pronouns, major, college, year, plan, co-ops, clubs, description)
- **guilds** — All per-server configuration. Every channel ID, role ID, feature toggle, and threshold lives here.
- **guild_admins** — Custom per-guild manager permissions with granular scopes
- **scheduled_messages** — Recurring automated messages with cron expressions
- **verifications** — Temporary email verification codes (6-char alphanumeric, 30-min expiry)
- **suggestions** — Feature suggestions with status tracking (`pending` → `approved`/`rejected`/`completed`)
- **sync_flags** — Internal key/value dirty flags (legacy; cache invalidation now uses the webhook server)
- **auth_tokens** — One-time tokens for web login (64-char, 5-min expiry, single-use)
- **user_xp** — Per-guild XP data: `total_xp`, `level`, `message_count`, `xp_message_count`, `last_message_at`. Unique on `(guild_id, discord_id)`. Index on `(guild_id, total_xp)` for leaderboard queries.
- **xp_archives** — XP backup/restore snapshots: `guild_id`, `archived_by`, `reason`, `data` (jsonb array of user XP snapshots), `user_count`, `total_xp_sum`, `restored_at`, `created_at`. Index on `guild_id`.
- **youtube_subscriptions** — YouTube channel notification subscriptions: `guild_id`, `youtube_channel_id`, `youtube_channel_name`, `notify_channel_id`, `custom_message` (template with `{title}`, `{url}`, `{channel}` placeholders), `last_video_id`, `is_enabled`, `created_at`, `updated_at`. Unique on `(guild_id, youtube_channel_id)`.

Note: Birthday data (`birth_month`, `birth_day`, `birth_year`) is stored on the **users** table as a global per-user property.

### Key Patterns

- All tables use UUID primary keys (`uuid("id").primaryKey().defaultRandom()`)
- Use `discord_id` / `guild_id` (varchar 20) as the logical unique key.
- Most content fields use `text` type (not varchar) — length validation happens in the application layer via zod.
- **Always upsert.** If a user or guild row doesn't exist, create it with sensible defaults.
- Repositories return typed objects, never raw query results.
- All timestamps are `timestamp with time zone`.

### Per-Guild Configuration (guilds table)

**None of these are environment variables.** All live in the database.

| Category | Columns |
|---|---|
| Verification | `verification_role_id`, `is_verification_sync_enabled` |
| Ban Sync | `is_ban_sync_enabled` |
| Welcome | `welcome_channel_id`, `welcome_message`, `is_welcome_enabled`, `dm_welcome_message`, `is_dm_welcome_enabled` |
| Logging | `log_channel_id`, `is_logging_enabled`, `log_events` (array of event types) |
| Intro Gate | `intro_channel_id`, `intro_role_id`, `is_intro_gate_enabled`, `intro_min_chars`, `intro_min_words` |
| Mod Notes | `mod_notes_channel_id` |
| Suggestions | `is_suggestions_enabled` |
| AI / Ask | `is_ask_enabled`, `ask_system_prompt` |
| Off-Topic | `offtopic_images`, `offtopic_message` |
| XP / Leveling | `is_xp_enabled`, `xp_min`, `xp_max`, `xp_cooldown_seconds`, `xp_levelup_channel_id`, `xp_excluded_channel_ids[]`, `xp_excluded_role_ids[]` |
| Birthdays | `is_birthday_enabled`, `birthday_channel_id`, `birthday_message`, `birthday_timezone` |
| YouTube | `is_youtube_enabled` |

When a setting is null or a feature toggle is false, the feature is simply inactive — no errors, no fallback.

### Guild Admin Permissions

The `guild_admins` table provides granular permissions for users who don't have Discord's MANAGE_GUILD permission. Available scopes:

`verification`, `welcome`, `logging`, `intro_gate`, `moderation`, `suggestions`, `ai`, `offtopic`, `xp`, `schedules`, `birthday`, `youtube`, `managers`, `*` (wildcard)

Discord MANAGE_GUILD always grants full access. The `guild_admins` table is additive.

## Environment Variables

Infrastructure secrets only. **No guild-specific values.**

```env
DISCORD_API_TOKEN=        # Bot token
BOT_CLIENT_ID=            # Application ID for command registration
DATABASE_URL=             # Neon connection string
RESEND_API_KEY=           # Resend API key
RESEND_FROM_EMAIL=        # Sender address for verification emails
OPENAI_API_KEY=           # OpenAI key
OPENAI_MODEL=gpt-5-mini   # Default model
WEBAPP_URL=               # e.g. https://app.drexeldiscord.com
JWT_SECRET=               # HMAC secret for signing JWTs
BOT_WEBHOOK_SECRET=       # Shared secret for webhook auth (min 16 chars, optional)
BOT_WEBHOOK_PORT=3001     # Port for the bot's webhook HTTP server (default: 3001)

# Web (additional)
BOT_WEBHOOK_URL=          # URL to bot's webhook server, e.g. http://localhost:3001
```

All validated with zod at startup. Missing required vars cause an immediate exit with a clear error.

## Web Dashboard

### Auth Flow

1. `/login` in Discord → `AuthService.generateToken()` → stores in `auth_tokens` (5-min expiry)
2. Bot replies ephemeral with button to `{WEBAPP_URL}/oauth?token=<token>`
3. Web `POST /api/auth` exchanges token for JWT `{ discord_id, iat, exp }`
4. JWT stored client-side, sent as `Authorization: Bearer <jwt>`

### API Routes

All routes validate input with zod. All return `{ error, code }` on failure.

- `POST /api/auth` — token → JWT exchange
- `GET /api/auth` — verify JWT, return user info + Discord avatar
- `GET /api/guilds` — list guilds user can manage (checks MANAGE_GUILD + guild_admins)
- `GET /api/profile` — current user's profile
- `PATCH /api/profile` — update profile
- `GET /api/server/[guildId]` — guild settings
- `PATCH /api/server/[guildId]` — update guild settings (scope-aware permission check)
- `GET /api/server/[guildId]/discord` — fetch Discord channels and roles for the guild
- `GET /api/server/[guildId]/leaderboard` — XP leaderboard from DB (paginated, admin auth)
- `GET/POST /api/server/[guildId]/schedules` — list/create scheduled messages
- `PATCH/DELETE /api/server/[guildId]/schedules/[scheduleId]` — update/delete a schedule
- `GET/POST /api/server/[guildId]/suggestions` — list/update suggestions
- `PATCH/DELETE /api/server/[guildId]/suggestions/[suggestionId]` — update status/archive
- `GET/POST /api/server/[guildId]/youtube` — list/create YouTube subscriptions
- `PATCH/DELETE /api/server/[guildId]/youtube/[subscriptionId]` — update/delete subscription
- `POST /api/server/[guildId]/youtube/resolve` — resolve YouTube URL/handle to channel ID + name
- `GET /api/leaderboard/[guildId]` — public XP leaderboard (no auth required)

All `[guildId]` path params are validated against `/^[0-9]{17,20}$/` before any DB access. Schedule and subscription `[id]` params are validated as UUIDs.

### Web UI Features

- **Discord-like dark theme** using Tailwind CSS v4 custom colors (`dc-bg-primary`, `dc-accent`, etc.)
- **Responsive design** — sidebar collapses to hamburger menu on mobile
- **Auto guild discovery** — sidebar shows servers user can manage
- **Server icons + user avatars** from Discord CDN
- **Channel/role dropdowns** — fetched from Discord API, no manual ID entry
- **Rich text editor** — contenteditable with inline channel mention pills (`#channel-name`), `{member}/{server}` placeholder buttons, and `#` autocomplete
- **Scheduled messages page** — create, edit, toggle, delete with inline editing and delete confirmation modal
- **Profile page** — Drexel-specific dropdowns for Year, Plan, and College

### Lazy Initialization

The web app uses lazy proxies for `env` and `db` to avoid build-time errors (Vercel builds without env vars):
- `env` — Proxy that validates on first property access, not import
- `db` — Proxy that creates the Drizzle client on first query

## Bot Features

### XP / Leveling

MEE6-style XP with in-memory caching to minimize DB writes (Neon charges for compute time).

- **Startup:** `XpService` hydrates all `user_xp` rows into memory
- **Message XP:** Random XP per message (`xp_min`–`xp_max`), per-user cooldown, excluded channels/roles. All in-memory — zero DB writes per message.
- **Level-up:** Announces in `xp_levelup_channel_id` if set
- **`/rank`, `/leaderboard`:** Served entirely from memory
- **4-hour flush:** Batch-upserts dirty entries to DB; skipped if nothing changed. Uses `isFlushing` guard + sets `lastFlushAt` synchronously before the async call to prevent races.
- **Graceful shutdown:** SIGTERM/SIGINT handlers flush before exit
- **Archives (backup/restore):** `/xp-admin reset-all` archives current XP state to `xp_archives` (jsonb snapshot) before zeroing. `/xp-admin restore <archive_id>` auto-archives current state first (undo is always possible), then restores. `/xp-admin archives` lists the 10 most recent snapshots.
- **Public leaderboard:** `/api/leaderboard/[guildId]` serves leaderboard data without auth.

### YouTube Notifications

RSS-based YouTube upload notifications managed entirely via the web dashboard. No Google API key required.

- **Subscriptions:** Admins add YouTube channels via the dashboard. The web API resolves YouTube URLs/handles/names to channel IDs by scraping page metadata.
- **`YouTubeChecker`** runs on a 4-hour interval. Fetches YouTube RSS feeds, deduplicates by `last_video_id`, and posts to the configured Discord channel.
- **Catch-up mode:** On startup, silently syncs latest video IDs without announcing to avoid duplicate posts after restarts.
- **Custom messages:** Optional template with `{title}`, `{url}`, `{channel}` placeholders. Default: `**{channel}** just uploaded a new video!\n{url}`.
- **Guild toggle:** `is_youtube_enabled` master switch. Individual subscriptions also have `is_enabled`.

### Suggestions

Feature suggestion system with Discord submission and web dashboard management.

- **`/suggest <suggestion>`:** Creates a `suggestions` entry and replies with confirmation embed.
- **Mod notification:** If `mod_notes_channel_id` is configured, posts embed with suggestion text, user info, and thumbs-up/thumbs-down reactions.
- **Status workflow:** `pending` → `approved` / `rejected` / `completed` / `archived`.
- **Dashboard UI:** Filter by status, change status, archive/unarchive.

### Polls

Reaction-based polls via `/poll`. Purely client-side — no database, no web dashboard.

- **Yes/No mode:** If no options provided, adds thumbs-up/thumbs-down reactions.
- **Multi-option:** Up to 20 options with emoji support (Unicode, custom Discord emoji, guild shortcodes, fallback to regional indicators A-T).
- **No persistence:** Deleting the message loses all vote data.

### Scheduled Messages

- `node-cron` manages in-memory cron jobs
- On startup: loads all enabled schedules from DB
- **Webhook-triggered reload:** The web dashboard calls `POST /webhook/reload?guildId=<id>` on the bot's webhook server (port 3001) after any schedule change; bot calls `scheduler.reload(guildId)` immediately. **`BOT_WEBHOOK_URL` must point to port 3001, not 3000 (Next.js).**
- Supports plain text and embed messages (color, title)

### Audit Logging

Discord embed format matching the original bot:
- Author header with avatar
- Structured fields (User, Channel, etc.)
- ID code block at bottom with `js` syntax highlighting
- Events: `member_join`, `member_leave`, `message_delete`, `message_edit`, `role_change`, `nickname_change`, `voice_activity`, `kick`, `ban`

### Verification

- Email verification locked to `drexel.edu` and `dragons.drexel.edu` domains (hardcoded)
- Codes are 6-char alphanumeric, 30-min expiry
- Verification syncs across all servers with sync enabled

## Deployment

- **Bot** → Railway (persistent process, `pnpm --filter bot start` uses `tsx`)
- **Web** → Vercel (serverless Next.js, auto-detected)
- **Database** → Neon (serverless PostgreSQL)

Config files: `railway.json`, `vercel.json`

## Security

### General Principles

- **Never trust user input.** All data from Discord interactions, API request bodies, query params, and path params must be validated with zod before use. Guild IDs, channel IDs, role IDs, and user IDs are validated against `/^[0-9]{17,20}$/`.
- **No raw SQL.** Use Drizzle's query builder exclusively. If raw SQL is unavoidable, use parameterized queries — never interpolate user input into SQL strings.
- **No `eval()`, `Function()`, or dynamic code execution.** Never execute user-supplied strings as code.
- **No secret logging.** Never log tokens, API keys, JWTs, verification codes, or `DATABASE_URL`.

### Authentication & Authorization

- **JWT validation on every authenticated request.** Every API route that reads or writes user/guild data must verify the JWT signature and expiration.
- **Authorization is not authentication.** After verifying identity via JWT, always check the user has permission for the specific guild/resource (MANAGE_GUILD permission, guild_admins table entry, or resource ownership).
- **Auth tokens are single-use.** Delete the `auth_tokens` row immediately after JWT exchange. Never allow reuse.
- **Sensitive data is ephemeral.** Verification codes, login links, and tokens must only appear in ephemeral Discord replies — never in public channels.

### API Endpoint Security

- **Validate all path params before DB queries.** Return 400 for malformed IDs, not a DB error.
- **Scope all queries to the authenticated user's permissions.** An admin of Guild A must never access Guild B's data.
- **Return generic error messages to clients.** Stack traces, SQL errors, and internal details go to pino logs only.
- **No open redirects.** Never construct redirect URLs from user input. `WEBAPP_URL` is validated at startup.

### Webhook Server Security

- **Always verify `BOT_WEBHOOK_SECRET`** in the `Authorization` header. Reject unauthenticated requests.
- **Validate webhook payloads.** The `guildId` query param must pass snowflake validation before any work.

### Bot-Specific Security

- **Permission checks in commands.** Admin/mod commands must verify Discord permissions or guild_admins status in the handler — never rely solely on Discord's built-in command permissions.
- **AI prompt injection.** The `/ask` endpoint passes user input to OpenAI. System prompts must not contain secrets or internal implementation details. Sanitize or truncate excessively long inputs.
- **Email domain allowlist.** Verification is restricted to `drexel.edu` and `dragons.drexel.edu` in the service layer. Never add wildcard patterns.

### Environment & Deployment

- **`.env*.local` must be in `.gitignore`.** Never commit secrets.
- **All env vars are validated with zod at startup.** Missing required vars cause immediate exit — never fall back to empty strings for secrets.
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

- TypeScript strict mode, ESM (`"type": "module"` in all package.json files)
- `import` / `export` only — never `require` (except in env.ts dev fallback)
- `const` over `let`, never `var`
- Drizzle query builder for all DB access — no raw SQL
- All interaction replies with sensitive info (tokens, codes) must be **ephemeral**
- Embed colors: success `0x43b581`, error `0xff0000`, info `0xffcc00`, blurple `0x5865f2`
- File naming: kebab-case (`guild-member-add.ts`, `user.service.ts`)
- One export per file for commands and events
- All function parameters and return types must be explicitly typed — no `any`
- Prefer early returns over nested if/else
- Every service method that can fail throws `AppError` with a specific `ErrorCode`
- Logging: pino only — never `console.log`, `console.error`, or `console.warn`
- Tests live in `tests/` mirroring `src/` structure, named `*.test.ts`
- **Always use `interaction.editReply()`** in command handlers — never `interaction.reply()` — because the loader auto-defers all interactions before calling `execute()`. Exception: commands with `skipDefer: true` must use `interaction.reply()` instead since no defer has occurred.

## How to Add a New Feature

1. **Schema** — Add table/columns to `packages/db/src/schema.ts`, run `db:push`
2. **Repository** — Create `apps/bot/src/repositories/my-feature.repository.ts` (thin Drizzle wrapper)
3. **Service** — Create `apps/bot/src/services/my-feature.service.ts` (business logic, throws `AppError`)
4. **Wire up** — Add to `BotContext` in `types/context.ts`, instantiate in `index.ts`
5. **Command** — Create `apps/bot/src/commands/my-feature.ts` (auto-discovered on restart)
6. **Events** — Create `apps/bot/src/events/my-event.ts` if needed (auto-discovered)
7. **Web API** — Add routes to `apps/web/src/app/api/...`
8. **Web UI** — Add pages to `apps/web/src/app/dashboard/...`
9. **Verify** — Run `pnpm typecheck` and `pnpm test`
