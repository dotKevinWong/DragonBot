# AGENT.md — DragonBot v3

> This file provides context for AI coding assistants (Claude, Copilot, Cursor, etc.) working on this codebase.

## What Is This Project

DragonBot is a multi-guild Discord bot for university communities. It provides email verification, moderation tools, user profiles, AI Q&A, scheduled messages, audit logging, and a Next.js web dashboard.

**Key design constraint:** The bot is fully configurable per-guild. There are zero hardcoded guild, channel, or role IDs anywhere in the codebase. All server-specific settings live in the `guilds` database table and are managed via `/admin` commands or the web dashboard.

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
  };
  scheduler?: SchedulerManager;
}
```

### Command Interface

```typescript
interface BotCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, ctx: BotContext): Promise<void>;
}
```

Commands are auto-loaded from `src/commands/` at startup. The loader reads every `.ts` file, registers slash commands with Discord, and binds the interaction handler.

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
- **suggestions** — Feature suggestions with status tracking
- **sync_flags** — Lightweight flags for web→bot communication
- **auth_tokens** — One-time tokens for web login (64-char, 5-min expiry, single-use)

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

When a setting is null or a feature toggle is false, the feature is simply inactive — no errors, no fallback.

### Guild Admin Permissions

The `guild_admins` table provides granular permissions for users who don't have Discord's MANAGE_GUILD permission. Available scopes:

`verification`, `welcome`, `logging`, `intro_gate`, `moderation`, `suggestions`, `ai`, `offtopic`, `managers`, `*` (wildcard)

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
OPENAI_MODEL=gpt-4o-mini  # Default model
WEBAPP_URL=               # e.g. https://app.drexeldiscord.com
JWT_SECRET=               # HMAC secret for signing JWTs
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
- `GET/POST /api/server/[guildId]/schedules` — list/create scheduled messages
- `PATCH/DELETE /api/server/[guildId]/schedules/[scheduleId]` — update/delete a schedule

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

### Scheduled Messages

- `node-cron` manages in-memory cron jobs
- On startup: loads all enabled schedules from DB
- Hourly background sync as safety net
- `/schedule reload` command for immediate sync after web dashboard changes
- Supports plain text and embed messages

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
