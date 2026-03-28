# DragonBot v3

🐉 A multi-guild Discord bot built for Drexel University communities, featuring email verification, moderation tools, user profiles, AI Q&A, scheduled messages, and a web dashboard.

## 🎯 Features

- ✅ **Email Verification** — Verify Drexel students with `@drexel.edu` emails, synced across servers
- 👨‍⚖️ **Ban Syncing** — Bans propagate across all servers with ban sync enabled
- 😎 **User Profiles** — Students can share their name, major, college, year, co-ops, and more
- 🤖 **AI Ask** — `/ask` command powered by OpenAI for answering questions
- 📋 **Suggestions** — Community feature requests with status tracking
- 🔐 **Guild Managers** — Granular permission system for delegating server management
- 📝 **Audit Logging** — Discord-style log embeds for joins, leaves, bans, message edits/deletes, role changes, voice activity
- 🚪 **Introduction Gate** — Require new members to write a proper intro before accessing the server
- 👋 **Welcome Messages** — Customizable channel and DM welcome messages with placeholders
- ⏰ **Scheduled Messages** — Automated recurring messages with cron scheduling
- 🌐 **Web Dashboard** — Manage server settings, profiles, and schedules from a browser
- 📣 **Mod Tools** — Announcements and reactions via bot commands
- 🎲 **Fun Commands** — Dice rolls, LaTeX rendering, and more

## 🤓 Tech Stack

| Component | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Language** | TypeScript (ESM, strict mode) |
| **Bot** | discord.js 14 |
| **Database** | Neon (PostgreSQL) + Drizzle ORM |
| **Email** | Resend |
| **AI** | OpenAI SDK |
| **Web** | Next.js 16 (App Router) + Tailwind CSS v4 |
| **Auth** | Bot-generated token → JWT exchange |
| **Logging** | pino (structured JSON) |
| **Validation** | zod |
| **Scheduling** | node-cron |

## 📁 Project Structure

```
apps/bot/          — Discord bot (discord.js)
apps/web/          — Next.js web dashboard
packages/db/       — Shared Drizzle schema + database client
scripts/           — Migration and utility scripts
```

## 😎 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- A [Discord application](https://discord.com/developers/applications) with bot token
- A [Neon](https://neon.tech/) PostgreSQL database
- A [Resend](https://resend.com/) API key
- An [OpenAI](https://platform.openai.com/) API key

### Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/drexelDiscord/dragonbot.git
   cd dragonbot
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Create `.env`** in the project root:
   ```env
   DISCORD_API_TOKEN=
   BOT_CLIENT_ID=
   DATABASE_URL=
   RESEND_API_KEY=
   RESEND_FROM_EMAIL=
   OPENAI_API_KEY=
   OPENAI_MODEL=gpt-5-mini
   WEBAPP_URL=http://localhost:3000
   JWT_SECRET=          # Generate with: openssl rand -hex 32
   BOT_WEBHOOK_SECRET=      # Generate with: openssl rand -hex 32
   BOT_WEBHOOK_URL=        # Public URL for bot webhook (e.g. https://myapp.up.railway.app/webhook)
   BOT_WEBHOOK_PORT=      # Port for bot webhook server (e.g. 3001)
   ```

4. **Push the database schema**
   ```bash
   pnpm --filter @dragonbot/db db:push
   ```

5. **Start development**
   ```bash
   pnpm dev
   ```
   This runs both the bot and web dashboard concurrently.

### Commands

```bash
pnpm dev                                  # Run bot + web concurrently
pnpm --filter bot dev                     # Bot only
pnpm --filter web dev                     # Web only (http://localhost:3000)
pnpm --filter @dragonbot/db db:push       # Push schema to database
pnpm build                                # Build all packages
pnpm typecheck                            # TypeScript check across workspace
pnpm test                                 # Run tests
```

## 🚀 Deployment

| Service | Platform |
|---|---|
| **Bot** | [Railway](https://railway.com/) — long-running process with WebSocket |
| **Web** | [Vercel](https://vercel.com/) — serverless Next.js |
| **Database** | [Neon](https://neon.tech/) — serverless PostgreSQL |

See the deployment configs: `railway.json` and `vercel.json`.

## 🤖 Bot Commands

| Command | Description |
|---|---|
| `/verify email` | Start email verification |
| `/verify code` | Confirm verification code |
| `/whois @user` | View a user's profile |
| `/ask` | Ask the AI a question |
| `/suggest` | Submit a feature suggestion |
| `/admin` | Server configuration (19+ settings) |
| `/schedule` | Manage scheduled messages |
| `/rank [@user]` | View your XP rank |
| `/leaderboard` | View XP leaderboard |
| `/offtopic` | Random off-topic image/message |
| `/mod talk` | Send an announcement |
| `/mod react` | React to a message |
| `/xp-admin` | XP system management (admin) |
| `/membercount` | Server member statistics |
| `/roll` | Roll a d20 |
| `/latex` | Render LaTeX to image |
| `/login` | Get a web dashboard link |
| `/help` | List all commands |

## 👨‍💻Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🛡️ Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## 📝 License

DragonBot is licensed under the MIT License. See [LICENSE](LICENSE.md) for details.

## 👨‍⚖️ Legal

This project is not affiliated with Drexel University. DragonBot is not an official Drexel University product and is not endorsed by Drexel University.
