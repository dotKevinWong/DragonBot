# Contributing to DragonBot

We welcome all contributions — bug reports, feature requests, design suggestions, and pull requests. Thank you for helping improve DragonBot!

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- A [Discord Developer Application](https://discord.com/developers/applications)
- A [Neon](https://neon.tech/) PostgreSQL database (free tier works)

### Setup

1. Fork and clone the repository
   ```bash
   git clone https://github.com/YOUR_USERNAME/dragonbot.git
   cd dragonbot
   ```

2. Install dependencies
   ```bash
   pnpm install
   ```

3. Create a `.env` file in the project root (see [README.md](README.md#setup) for all variables)

4. Push the database schema
   ```bash
   pnpm --filter @dragonbot/db db:push
   ```

5. Start development
   ```bash
   pnpm dev
   ```

## Project Architecture

```
apps/bot/          — Discord bot (discord.js 14)
apps/web/          — Next.js 16 web dashboard (Tailwind CSS v4)
packages/db/       — Shared Drizzle ORM schema + database client
scripts/           — One-time migration scripts
```

### Layered Design

```
Command / Event Handler    (parse input, call service, format response)
         ↓
     Service Layer         (business logic, validation)
         ↓
    Repository Layer       (database queries only)
         ↓
      Drizzle ORM          (typed queries, schema)
```

**Rules:**
- Commands never import repositories directly — only call services
- Services never import discord.js — they receive and return plain data
- Repositories are thin wrappers around Drizzle queries — no business logic

### Code Style

- TypeScript strict mode, ESM (`"type": "module"`)
- `const` over `let`, never `var`
- Explicit types on all function parameters and returns — no `any`
- Early returns over nested if/else
- File naming: `kebab-case` (e.g. `guild-member-add.ts`, `user.service.ts`)
- Logging: `pino` only — never `console.log`
- Validation: `zod` for all input

### Useful Commands

```bash
pnpm dev                    # Run bot + web concurrently
pnpm build                  # Build all packages
pnpm typecheck              # TypeScript check
pnpm test                   # Run tests
pnpm lint                   # ESLint
```

## Bug Reports

[Open an issue](https://github.com/drexelDiscord/dragonbot/issues/new) with:

- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Screenshots (if applicable)

## Feature Requests

[Open an issue](https://github.com/drexelDiscord/dragonbot/issues/new) with:

- The feature you'd like to see
- Why it would be useful
- How you imagine it working

## Pull Requests

1. Create a branch from `main`
2. Make your changes following the code style above
3. Run `pnpm typecheck` and `pnpm test` to verify
4. Submit a PR with a clear description of what changed and why

### PR Checklist

- [ ] Code follows the project's layered architecture
- [ ] TypeScript strict mode — no `any` types
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (if applicable)
- [ ] New features include appropriate error handling with `AppError`
- [ ] Sensitive replies use `ephemeral: true`
- [ ] No hardcoded guild/channel/role IDs

## Security Vulnerabilities

See [SECURITY.md](SECURITY.md) for reporting security issues. **Do not open public issues for vulnerabilities.**
