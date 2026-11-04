# DragonBot codebase audit, 3 November 2026

The audit covered duplicated logic, dead code, performance bottlenecks and overly complex modules. It is read-only: no source code changed. Every change below waits for Kevin's approval.

## How it was done

- Seven readers mapped the architecture, one per area: bot core, commands, services and repositories, lib and utils, web server, web UI, and the db package with the infrastructure.
- Eight finders searched for the four issue types in two halves, the bot and web plus db. They returned 67 raw findings.
- One merger removed duplicates, leaving 48 findings.
- Each finding then went to two independent verifiers. A sceptic tried to refute it; 47 survived and 1 was refuted (P9). A second reviewer checked that the fix can keep behaviour identical, wrote a fix plan, and listed the tests to write first.
- The impact and effort shown are the verifiers' corrected values. Where the sceptic lowered a finder's rating, the table uses the lower one.

Baseline before any change, on 3 November 2026: `apps/bot` has 241 passing vitest tests in 21 files, and `tsc --noEmit` is clean for both the bot and the web app. `apps/web` and `packages/db` have no tests.

## Read this first: defects that a refactor cannot fix without changing behaviour

You asked that the refactor change no functionality. The audit found these real defects along the way. Fixing any of them changes behaviour by design, so each needs its own yes. They are kept apart from the pure refactors.

| # | Defect | Where | From | Impact | Effort |
|---|---|---|---|---|---|
| B1 | Dashboard write routes for schedules, YouTube and suggestions call `checkGuildPermission` without a scope. A manager holding any single scope, such as only `welcome`, can create, edit and delete schedules, YouTube subscriptions and suggestions. The settings PATCH does check scopes per field. | `apps/web/src/app/api/server/[guildId]/{schedules,youtube,suggestions}/**` | D1 | high (permissions) | S |
| B2 | XP flush race. `flushInternal` writes a snapshot and then sets `dirty = false` on every entry, including entries that changed while the write was awaiting. Those changes are not saved, and are lost on restart unless the user posts again. | `apps/bot/src/services/xp.service.ts:203-235` | P4 | medium (data loss) | S |
| B3 | XP earned between `clientReady` and `xpService.hydrate()` is overwritten by the hydrate and can post a false level-up. Dashboard reload pings in that window are refused, because the webhook server starts only after the birthday and YouTube checks. | `apps/bot/src/index.ts:130-181` | P10 | medium | S |
| B4 | The `/discord` route's shortcut lets through a `guild_admins` row with an empty permission list, which every other check denies. It also misses managers of more than one guild because of `.limit(1)`. | `apps/web/src/app/api/server/[guildId]/discord/route.ts:49-50` | D3 | medium (permissions) | S |
| B5 | A rejected intro message is deleted, but the handler doesn't return, so the deleted message still earns XP and can post a level-up. | `apps/bot/src/events/message-create.ts:57-83` | C1 | low | S |
| B6 | `guild-member-update` fetches a partial old member before diffing. The fetch returns the current state, so role and nickname changes on uncached members are never logged. | `apps/bot/src/events/guild-member-update.ts:12-18` | P7 | low | S |
| B7 | The bot requires `JWT_SECRET` (at least 32 characters) only for dead JWT code. Removing the requirement changes startup validation. | `apps/bot/src/config.ts:12` | X1 | low | S |

One trade-off is not a defect. XP is persisted only by the 4-hour sync and on shutdown signals (P5). AGENTS.md records this as a deliberate choice to keep Neon compute costs down. A SIGKILL or OOM kill loses up to 4 hours of XP.

## Recommended order

1. **Approve the defect fixes you want (B1 to B7).** B1 and B2 come first. Each is S effort and gets a test written before the fix.
2. **Make the cheap, behaviour-preserving wins:** P2 (`next/link` in the sidebar), P7 (check `shouldLog` before the REST calls), P15, P13, X7, X9, X4 and X2/X3 (deleting dead code), and D2, D9, D10 and D13.
3. **Do the web performance work, P1, P6 and P3.** Dashboard loads make up to about 60 sequential Discord calls per page change today. A request-scoped memo of guild and member lookups, plus P2, removes most of them. These are M effort, and the web app needs a test runner first.
4. **Consolidate the web routes and permission checks, D1 and D3.** Add one `requireGuildAccess(req, params, scope)` helper and one `hasScope` in `packages/db/src/permissions.ts`. The verifier lists exact per-route error bodies that must stay as they are. Pin them with tests before moving any code.
5. **Break up the large modules, C1, C2, C3 and C4.** Do each behind characterization tests: `message-create`, `xp-admin`, the 921-line settings page, and `index.ts`.

## Prerequisite for any web refactor

`apps/web` has no test runner. Every web finding's fix plan begins by adding vitest to `apps/web` and writing characterization tests of today's behaviour: status codes, error bodies, field order and fail-closed paths. Only then should code move. That setup is about S to M effort, and it pays off across D1, D3, D6, D7, P1, P3, P6, P13 and C3.


## All confirmed findings

Sorted by impact after verification, then by effort. Effort: S = under 1 hour, M = about half a day, L = more than a day.

| ID | Impact | Effort | Category | Finding |
|---|---|---|---|---|
| [D1](#d1) | high | M | duplication | Auth/guild-ID/permission preamble copied into ~14 API route handlers; error bodies have drifted and write routes never pass a scope |
| [D2](#d2) | medium | S | duplication | /admin managers-add and managers-update copy the privilege-escalation guard (grant policy lives in the command) |
| [P2](#p2) | medium | S | performance | Dashboard sidebar uses plain <a href>, so every click reloads the layout and reruns /api/guilds and /api/auth |
| [P4](#p4) | medium | S | performance | XP flush can mark entries clean that changed during the flush, losing their latest counts |
| [P6](#p6) | medium | S | performance | Every guild-scoped API call pays sequential uncached Discord calls before the DB check; dashboard pages fan out and refetch the same guild |
| [P7](#p7) | medium | S | performance | Logging handlers call Discord REST (message fetch, member fetch, audit log) before checking whether logging is enabled |
| [C1](#c1) | medium | M | complexity | message-create.ts is an untested 3-feature god handler on the hottest path |
| [C2](#c2) | medium | M | complexity | xp-admin.ts: 285-line execute holding archive/reset/restore workflows, direct repository access, and duplicated guards/types |
| [C3](#c3) | medium | M | complexity | Server settings page is a 921-line god component with 8 UI primitives, a 260-line rich editor, a hand-duplicated settings type and safety-critical save-diff logic |
| [D3](#d3) | medium | M | duplication | Permission-scope rules and guild_admins lookup implemented in four forms; the /discord route's shortcut disagrees with the rest |
| [P1](#p1) | medium | M | performance | /api/guilds makes up to ~60-80 sequential Discord calls per dashboard load, fetching each guild and member twice |
| [P10](#p10) | medium | M | performance | Startup runs every step serially; webhook server and sync timer start only after birthday and YouTube checks, and XP earned before hydrate is overwritten |
| [P3](#p3) | medium | M | performance | Leaderboard routes resolve up to 100 Discord users per request in fixed waves with a per-instance cache, on a public unauthenticated route |
| [C5](#c5) | low | S | complexity | AGENT.md layering rules contradict the code (repositories used from commands/lib, discord.js in services) |
| [D10](#d10) | low | S | duplication | NeonActivityLogger class copied verbatim in both DB clients |
| [D11](#d11) | low | S | duplication | Server-only guard and AppError catch boilerplate repeated in most commands |
| [D12](#d12) | low | S | duplication | Verification-role assignment written three times with different error handling |
| [D13](#d13) | low | S | duplication | Birthday month names and next-occurrence year computed twice |
| [D15](#d15) | low | S | duplication | Three cron-to-text formatters (bot command, schedules page, CronBuilder) |
| [D4](#d4) | low | S | duplication | Shared contracts and patterns copied by hand: log event names (3 copies), suggestion statuses, UUID_RE (3), YouTube channel regex (2), snowflake regex, DiscordChannel type (3), timezone list (2) |
| [D6](#d6) | low | S | duplication | Leaderboard query and table written twice (public and dashboard) |
| [D7](#d7) | low | S | duplication | Two Discord user fetchers for the same endpoint plus three hand-written CDN URL builders |
| [D8](#d8) | low | S | duplication | Two near-copies of session-token extraction in auth.ts with different fallback rules |
| [D9](#d9) | low | S | duplication | Discord error helpers duplicated between honeypot-enforcer and honeypot-warning (and inline in moderation.service) |
| [P11](#p11) | low | S | performance | Birthday queries: same per-date query runs once per guild, /next-birthdays loads every birthday, no index on birthday columns |
| [P13](#p13) | low | S | performance | PATCH /api/server/{id} reads the same guild row twice; sensitive-field strip code copied in GET/PATCH |
| [P14](#p14) | low | S | performance | Index gaps and a redundant index versus queried columns |
| [P15](#p15) | low | S | performance | /discord route sorts with raw.find inside the comparator (quadratic) |
| [P16](#p16) | low | S | performance | Every dashboard save triggers a full cross-guild scheduler.reload() on the bot |
| [P17](#p17) | low | S | performance | Web imports the @dragonbot/db root, pulling the postgres-js client module into web bundles |
| [P5](#p5) | low | S | performance | XP is persisted only every 4 hours; startFlushTimer exists but nothing calls it |
| [P8](#p8) | low | S | performance | Guild settings cache has no negative caching and no in-flight sharing: every miss is a DB query per event |
| [X1](#x1) | low | S | dead-code | Unused AuthService JWT/exchange code, its ErrorCodes, and the JWT_SECRET it forces the bot to require |
| [X10](#x10) | low | S | dead-code | Stale web internals: exported getDb, DiscordUser.discriminator, unneeded dynamic imports, legacy Bearer fallback |
| [X2](#x2) | low | S | dead-code | Unused service, scheduler, cache and XpService methods (incl. ScheduledMessageService write path and parseIntervalToCron) |
| [X3](#x3) | low | S | dead-code | Unused repository methods |
| [X4](#x4) | low | S | dead-code | Entirely unused utils/time.ts and utils/course.ts, plus unused logEmbed, COLORS.log and ErrorCode members |
| [X5](#x5) | low | S | dead-code | Unused BotContext fields (db, email, birthdayChecker, youtubeChecker) |
| [X6](#x6) | low | S | dead-code | Superfluous exports (used only in-file) and stale @types/node-cron |
| [X7](#x7) | low | S | dead-code | Dead markSchedulesDirty helper and orphaned sync_flags table |
| [X8](#x8) | low | S | dead-code | Unused SUBCOMMAND_SCOPE_MAP export |
| [X9](#x9) | low | S | dead-code | Unused locals and write-only state flagged by tsc in the web app |
| [C4](#c4) | low | M | complexity | index.ts main() (~210 lines) mixes wiring, background jobs, timers and duplicated crash handlers |
| [D14](#d14) | low | M | duplication | Repeated CRUD handlers and loaders in schedules and YouTube dashboard pages; 401 redirect in 6 places |
| [D16](#d16) | low | M | duplication | Repeated form markup across dashboard pages (label/input class strings; profile's local Input/Select) |
| [D5](#d5) | low | M | duplication | Log-channel embed boilerplate repeated across 6 event handlers; message-update copies message-log's ID block |
| [P12](#p12) | low | M | performance | XP rank and leaderboard reads scan the XP map for all guilds with per-entry copies, twice per /leaderboard |

## Details

### D1
**Auth/guild-ID/permission preamble copied into ~14 API route handlers; error bodies have drifted and write routes never pass a scope**

Impact **high** (the finder said high) · Effort **M** · Category duplication

Locations: `apps/web/src/app/api/server/[guildId]/route.ts:14`, `apps/web/src/app/api/server/[guildId]/route.ts:46`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:37`, `apps/web/src/app/api/server/[guildId]/suggestions/route.ts:13`, `apps/web/src/app/api/server/[guildId]/suggestions/[suggestionId]/route.ts:10`, `apps/web/src/app/api/server/[guildId]/suggestions/[suggestionId]/route.ts:22`, `apps/web/src/app/api/server/[guildId]/suggestions/[suggestionId]/route.ts:64`, `apps/web/src/app/api/server/[guildId]/schedules/route.ts:25`, `apps/web/src/app/api/server/[guildId]/schedules/route.ts:54`, `apps/web/src/app/api/server/[guildId]/schedules/[scheduleId]/route.ts:11`, `apps/web/src/app/api/server/[guildId]/schedules/[scheduleId]/route.ts:28`, `apps/web/src/app/api/server/[guildId]/schedules/[scheduleId]/route.ts:71`, `apps/web/src/app/api/server/[guildId]/youtube/route.ts:24`, `apps/web/src/app/api/server/[guildId]/youtube/route.ts:53`, `apps/web/src/app/api/server/[guildId]/youtube/[subscriptionId]/route.ts:11`, `apps/web/src/app/api/server/[guildId]/youtube/[subscriptionId]/route.ts:24`, `apps/web/src/app/api/server/[guildId]/youtube/[subscriptionId]/route.ts:67`, `apps/web/src/app/api/server/[guildId]/youtube/resolve/route.ts:14`, `apps/web/src/app/api/profile/route.ts:36`, `apps/web/src/lib/discord.ts:132`, `packages/db/src/permissions.ts:11`

**What the code does.** Every handler repeats getAuthenticatedUser -> 401; await params; DISCORD_SNOWFLAKE_RE (plus UUID_RE, declared in three files) -> 404; checkGuildPermission -> 403. The 7-line `{ error: "Invalid data", ...(NODE_ENV !== "production" && { details }) }` block appears 7 times. The copies have drifted: some 401/403 bodies carry `code` ([guildId]/route.ts:16,28) and others do not (schedules/[scheduleId]/route.ts:30,41); one 404 says "Server not found" where the rest say "Not found". No caller ever passes checkGuildPermission's `scope`, so a guild_admins user holding any single scope (e.g. only "welcome") can POST/PATCH/DELETE schedules, YouTube subscriptions and suggestions, even though the schedules/youtube/suggestions scopes exist (permissions.ts:11-13).

**Verifier's notes.** I could not refute the finding. The code matches the description. All 13 handlers in apps/web/src/app/api/server/[guildId]/** follow the same steps in the same order: getAuthenticatedUser returns 401, then the snowflake check (plus UUID_RE) returns 404, then checkGuildPermission returns 403. UUID_RE is declared word for word in three files: schedules/[scheduleId], youtube/[subscriptionId] and suggestions/[suggestionId]. The "Invalid data" plus dev-only details block appears 7 times; only [guildId]/route.ts and profile/route.ts include code:"VALIDATION_ERROR". The error bodies have drifted as described. [guildId]/route.ts and discord/route.ts send 401 and 403 bodies with a code field; schedules, youtube, suggestions and resolve send bare {error:"Unauthorized"} and {error:"Forbidden"}. [guildId]/route.ts says "Server not found" where the others say "Not found". leaderboard uses code "FORBIDDEN" where the others use "UNAUTHORIZED", which is a further drift. No caller passes a scope to checkGuildPermission. Without a scope, any non-empty guild_admins row grants access (discord.ts: `if (!scope) return true`). So a manager holding only "welcome" can write schedules, YouTube subscriptions and suggestions, even though those scopes exist in PERMISSION_SCOPES. Only PATCH /api/server/[guildId] enforces scopes, through FIELD_SCOPE_MAP. The copies differ only in their response bodies, which the proposed fix keeps by taking the bodies as parameters. I'd keep the impact at high. The duplication alone would be medium, but it hides the missing scope checks on writes. That conflicts with AGENT.md's description of scopes as granular permissions.

**Fix plan.** Feasible as a pure refactor if the helper takes each route's existing response bodies as parameters instead of normalising them. Scope the work to the routes that really share the preamble, and leave the outliers alone.

Routes that share the preamble (getAuthenticatedUser -> 401, await params, regex check -> 404, checkGuildPermission(guildId, discordId) -> 403):
- schedules/route.ts (GET and POST)
- schedules/[scheduleId]/route.ts (PATCH and DELETE)
- youtube/route.ts (GET and POST)
- youtube/[subscriptionId]/route.ts (PATCH and DELETE)
- youtube/resolve/route.ts
- suggestions/route.ts (GET)
- suggestions/[suggestionId]/route.ts (two handlers)
- [guildId]/route.ts GET

Routes to leave alone or handle specially:
- discord/route.ts does a guild_admins pre-lookup before checkGuildPermission and skips the Discord API call for custom admins. Its permission step cannot be replaced by requireGuildAccess, so reuse only the 401 and 404 steps, or leave the route untouched. Folding it in would change the number of Discord calls and DB queries.
- [guildId]/route.ts PATCH uses getUserGuildPermissions plus per-field scopes, then validates the body. Keep its permission logic. It could reuse only the 401 and 404 steps.
- leaderboard/route.ts uses isGuildMember with code FORBIDDEN. Exclude it.
- profile/route.ts has no guild step. Reuse only invalidDataResponse.
- guilds/route.ts and auth/route.ts are not part of this finding.

Steps:
1. Add apps/web/src/lib/route-guard.ts. Export UUID_RE, with the same regex and /i flag as today's three copies. Export requireGuildAccess(request, guildId, { extraIds?: [value, UUID_RE][], unauthorizedBody, notFoundBody, forbiddenBody }).
   - Run the checks in this order: getAuthenticatedUser (return 401 if absent), then the snowflake and extra-ID tests (404), then checkGuildPermission(guildId, discordId) (403).
   - Return { discordId } or a NextResponse.
   - Do not accept or forward a scope argument yet, or accept it but have no caller pass one.
2. Handle params in the callers. `await params` must stay after the 401 check in the current code. The helper cannot await params before auth unless it receives the params promise. So either pass the params promise and await it inside the helper after the auth check, or keep `await params` in the route and call auth first. Prefer passing a thunk or the promise so the order stays auth -> params -> validation.
3. Add invalidDataResponse(issues, { withCode }). It must emit exactly { error: "Invalid data", [code: "VALIDATION_ERROR" when withCode], ...(NODE_ENV !== "production" && { details: issues }) } with status 400. Keep the key order error, code, details. Use withCode:true for [guildId] PATCH and profile PATCH. Use false for schedules, youtube and suggestions.
4. Define body constants once per drift class. These are the current bodies:
   - Class A, no code: 401 {error:"Unauthorized"}, 403 {error:"Forbidden"}. Used by schedules, youtube, suggestions and resolve. 404 is {error:"Not found", code:"NOT_FOUND"}.
   - Class B, with code: 401 {error:"Unauthorized", code:"UNAUTHORIZED"}, 403 {error:"Forbidden", code:"UNAUTHORIZED"} (note the code value is UNAUTHORIZED on a 403). Used by [guildId] GET and discord. 404 is "Server not found" on [guildId] and "Not found" on discord.
5. Migrate one route at a time, smallest first: resolve, then suggestions, schedules, youtube, then [guildId] GET. Delete the local UUID_RE copies.
6. Leave the post-guard 404s such as {error:"Not found"} without code (schedules/[scheduleId]/route.ts:60 and 93) untouched. They are not part of the preamble.
7. Out of scope: per-route scope enforcement. Record it as a separate finding for Kevin to approve. A guild_admins user with any single scope can today mutate schedules, YouTube subscriptions and suggestions, because checkGuildPermission is called without a scope. Leave the helper's scope option undefined everywhere.

Note on the finding text. Two corrections to the proposed plan:
- The "[guildId]/route.ts:14/46" citations are accurate, but PATCH does not use checkGuildPermission.
- "~14 handlers" is about right for the routes listed above, but only about 12 can use requireGuildAccess unchanged.

**Behaviour to keep the same.** - Check order must stay 401, then 404 (guildId and then the extra ID in a single combined test), then 403. Today `await params` happens after the 401. A malformed or absent session must still return 401 before the ID validation runs.
- Per-route body drift must be preserved exactly:
  - Class A routes have no `code` on 401/403, but their 404 does have code NOT_FOUND.
  - [guildId] GET/PATCH return 404 text "Server not found", while discord, leaderboard and the others return "Not found".
  - The 403 on class B carries code "UNAUTHORIZED", not "FORBIDDEN". Leaderboard alone uses FORBIDDEN.
  - Post-guard 404s (row not found) differ again: some have no code, [guildId] PATCH has "Server not found" with code NOT_FOUND.
- invalidDataResponse: the `code` key is present only on [guildId] PATCH and profile. JSON key order should stay error, code, details. The `details` key appears only when NODE_ENV !== "production". Evaluate NODE_ENV at call time, as today, not at module load.
- Do not move the guild_admins pre-lookup out of discord/route.ts. It avoids a Discord API call, so changing it would alter latency and rate-limit behavior.
- [guildId] PATCH needs getUserGuildPermissions, which differs from checkGuildPermission in that an empty permissions array gives 403. Do not replace it with the shared guard, or per-field scope checks and the missing-scopes message would be lost.
- Do not enforce scopes in this refactor. Doing so would lock out existing scoped managers, as the finding notes.
- Regex and flags. Keep the UUID_RE /i flag. Keep DISCORD_SNOWFLAKE_RE imported from validators.ts. Note that the regexes have no `g` flag, so .test is stateless. Do not add a `g` flag when hoisting them.
- Early return type. If the helper returns `NextResponse | { discordId }`, callers need a discriminating check such as `instanceof Response`. A mistaken truthiness check would leak a response as a user.
- The resolve route reads the body only after the guard. Preserve that, because reading request.json() before auth would change the error behavior for a non-JSON body from an unauthenticated caller.
- JSON parse failures (request.json() throwing) currently surface as an unhandled 500 in several handlers. Do not "fix" this in the refactor.

**Tests.** Existing coverage: none for apps/web. The only tests are in apps/bot/tests (Vitest-style files for events, services, utils, honeypot and scheduler), and none touch the API routes, route-guard behavior or packages/db permissions.ts. Nothing guards this refactor today.

Characterization tests to add BEFORE refactoring (a new apps/web test setup, e.g. Vitest, mocking @/lib/auth, @/lib/discord, @/lib/db and @/lib/bot-webhook):
1. A table-driven snapshot test per migrated handler (GET/POST/PATCH/DELETE) asserting status and exact JSON body for:
   - no auth (401)
   - malformed guildId (404)
   - malformed scheduleId, subscriptionId or suggestionId (404) with a valid guildId
   - checkGuildPermission false (403)
   - valid-guard happy path
   Assert the call order, for example that checkGuildPermission is not called when the ID is invalid and that the auth mock is called before params are consumed.
2. JSON-body assertions that pin the drift: `code` absent on class A, present on class B, "Server not found" on [guildId], and the 403 code value UNAUTHORIZED.
3. invalidDataResponse tests: with and without code, NODE_ENV production vs development (details present or absent), and key order.
4. A test that checkGuildPermission is called with exactly (guildId, discordId) and no third argument on every migrated route. This pins today's scope-less behavior and will flag an accidental scope change.
5. A discord route test confirming the guild_admins shortcut still skips checkGuildPermission.
6. Generate the expected values by recording the current handlers' outputs first, and commit the tests green on the pre-refactor code. Then migrate and confirm the same tests still pass unchanged.
7. As the finding suggests, also run curl checks as a smoke test: 401 with no cookie, 404 with a bad ID, 403 for a non-admin. Do this before and after the change and diff the bodies.

### D2
**/admin managers-add and managers-update copy the privilege-escalation guard (grant policy lives in the command)**

Impact **medium** (the finder said high) · Effort **S** · Category duplication

Locations: `apps/bot/src/commands/admin.ts:57`, `apps/bot/src/commands/admin.ts:141`, `apps/bot/src/commands/admin.ts:155`, `apps/bot/src/commands/admin.ts:225`, `apps/bot/src/commands/admin.ts:238`, `apps/bot/src/services/guild-admin.service.ts:95`

**What the code does.** managers-add (:141-166) and managers-update (:225-249) are identical except for the service call and success text: both parse permStr.split(','), validate against PERMISSION_SCOPES, run the 'You can only grant permissions you have' check (caller lacks '*' and requests '*' or an unheld scope) and catch AppError. That check is a security guard kept in two places, so a fix to one copy can leave a privilege-escalation path in the other. GuildAdminService.validatePermissions re-validates with a different message but can never trigger from the bot because the command checks first. execute (:57-265) is an if-chain over 6 subcommands with a separate permission pre-check (:71-89). No tests cover commands/admin.ts.

**Verifier's notes.** I confirmed the finding against the code. In apps/bot/src/commands/admin.ts, managers-add (lines 141-181) and managers-update (lines 225-264) have the same code for parsing (split, trim, lowercase), the same PERMISSION_SCOPES validation with the same text, the same guard that blocks a caller without Manage Server from granting a scope they don't hold, and the same AppError handling. They differ only in the service call and the success text. GuildAdminService.validatePermissions (guild-admin.service.ts:95) validates the scopes again with a different message, but the command's earlier check means it never fires from the bot. No test file references commands/admin.ts. Both copies of the guard are identical and correct today, so nothing is broken; the risk is that the two copies drift apart later. The duplicated block is about 25 lines in one file and the fix is small. Because nothing is exploitable now and the risk is hypothetical, I rate it medium, not high.

**Fix plan.** Scope: apps/bot/src/commands/admin.ts only (plus one new test file). The two blocks at admin.ts:141-166 and :225-249 are byte-identical apart from the service call (addAdmin vs updatePermissions) and the success text.

1. Write characterization tests first (see testsNeeded) and confirm they pass against the current code.
2. In admin.ts add two module-level helpers, not exported from the command:
   - parsePermissionList(str: string): string[] = str.split(",").map(p => p.trim().toLowerCase()). It does not filter empties, so "a,,b" and "" still yield "" and are reported as invalid, as today.
   - async function checkGrant(ctx, guildId, callerId, hasManageGuild, requested): Promise<string | null>. It returns the exact error message to show, or null if the grant is allowed. Steps, in this order:
     a. invalid = requested.filter(p => !(PERMISSION_SCOPES as readonly string[]).includes(p)). If non-empty, return `Invalid permissions: \`${invalid.join(", ")}\`\nValid: \`${PERMISSION_SCOPES.join(", ")}\``.
     b. If hasManageGuild, return null. Do not call getPermissions in this case.
     c. callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, callerId). If callerPerms.includes("*"), return null.
     d. unauthorized = requested.filter(p => p !== "*" && !callerPerms.includes(p)). If unauthorized.length > 0 || requested.includes("*"), return `You can only grant permissions you have. Missing: ${requested.includes("*") ? "*" : unauthorized.join(", ")}`.
     e. Return null.
   Returning a string, or a small discriminated union formatted at the call site, keeps the message text in a single place. The proposed GuildAdminService.checkGrant is optional. It would move policy into the service and need a hasManageGuild argument, but the message formatting must stay in the command to keep strings identical. The smallest safe change is helpers in admin.ts, with the policy moved to the service later if wanted.
3. Collapse the two branches into one shared path. After the shared permission pre-check, use `if (sub === "managers-add" || sub === "managers-update")`. In it: read targetUser and permStr, call parsePermissionList and checkGrant, and on a non-null result do editReply({embeds:[errorEmbed(msg)]}) and return. Then run the try/catch with a per-sub variant: addAdmin(guildId, targetUser.id, permissions, userId) with `Added ${targetUser.toString()} as a manager with permissions: \`...\``, or updatePermissions(...) with `Updated ${targetUser.toString()} permissions to: \`...\``. Keep the AppError catch (editReply errorEmbed(err.message), return) and rethrow anything else. A small `const isAdd = sub === "managers-add"` avoids a second if-chain.
4. Leave GuildAdminService.validatePermissions untouched as defence in depth. It is private and cannot be reached with invalid input from the bot, but the web dashboard or other callers may rely on it.
5. Optional, separate commit: a handler map for the 6 subcommands. It is purely structural. Do not combine it with the guard dedupe, so a diff reviewer can see the security logic is unchanged.
6. Verify with tsc and the new tests, then run the existing suite.

**Behaviour to keep the same.** - Order of checks must stay: (1) invalid scopes, (2) grant check, (3) service write. Invalid-scope errors must win even for a caller who also lacks permissions. getPermissions must not run before the scope validation.
- The ManageGuild bypass must stay a short-circuit that skips getPermissions entirely. Today a ManageGuild or Administrator holder makes no DB or cache call for this check, and a test that asserts getPermissions was not called depends on it.
- The wildcard-caller short-circuit (callerPerms includes "*") allows everything, including granting "*".
- When "*" is requested by a non-wildcard, non-ManageGuild caller, the Missing text is exactly "*", even if other unheld scopes were also requested. Otherwise it is the unauthorized list joined by ", " in request order, with no deduplication.
- "*" is excluded from the unauthorized filter, so a caller holding "*" never reaches it. A non-wildcard caller requesting only held scopes passes. Note "managers" is itself a valid scope, so a caller with "managers" can grant "managers".
- Message formatting must stay byte-identical: backticks around the invalid list, a literal newline before "Valid:", and a capital "Missing:". Both subcommands currently use the same texts. Only the success strings differ ("Added ... as a manager with permissions:" vs "Updated ... permissions to:").
- Parsing: trim and lowercase, no empty-string filtering, no dedupe. Duplicates such as "xp,xp" are passed to the service unchanged.
- managers-update ordering: the grant check runs before the service's ADMIN_NOT_FOUND check, so a caller without rights who targets a non-manager sees the grant error, not "not a guild manager". Keep that.
- AppError is caught and shown with its message. Non-AppError is rethrown. Do not widen the catch to cover the grant check.
- The shared permission pre-check at :71-89 and the early return for a missing guildId must run before any of this, unchanged.
- Latent behaviours to preserve and flag but not fix in this refactor: managers-update's guard checks only the requested scopes, not the target's existing ones, so a limited manager with "managers" can overwrite a wildcard manager's permissions and downgrade them. Separately, managers-add and managers-update do not stop a caller changing their own entry. These are policy gaps and would be functional changes, so they belong in a separate approved ticket.
- Merging the two branches means a future edit to one subcommand's success text must not leak to the other. Keep the strings as per-sub literals.

**Tests.** Existing coverage: none for apps/bot/src/commands/admin.ts and, as far as ls/git ls-files shows, no *.test.ts files for the guild-admin service or the commands directory (my searches found none; confirm the repo's test runner and location before adding). The finding's claim of no command tests is correct.

Add before refactoring, in a new apps/bot test file (vitest or whichever runner the repo uses). Mock interaction with options.getSubcommand/getUser/getString, memberPermissions.has, editReply (jest/vi fn), user.id, guildId, guild; mock ctx.services.guild.ensureGuild, guildAdmin.hasPermission, hasAnyPermission, getPermissions, addAdmin, updatePermissions. Run each case for both managers-add and managers-update (it.each over sub, with the service spy and success text chosen per sub), and assert both the exact embed description and that the write method was or was not called, and that getPermissions was or was not called:
1. Invalid scope ("xp,bogus") by an unprivileged caller (hasPermission "managers" true, getPermissions ["managers"]). Expect the "Invalid permissions: `bogus`\nValid: `...`" error, no write, and getPermissions not called.
2. Mixed invalid and unheld scopes. Expect the Invalid error wins.
3. "*" requested by a non-ManageGuild caller with scopes ["managers","xp"]. Expect "...Missing: *", no write.
4. "*,xp" where the caller lacks xp. Expect Missing is "*" only.
5. Unheld scope ("xp,logging", caller holds ["managers","xp"]). Expect "Missing: logging", no write. Also a multi-missing case to lock the join order and the ", " separator.
6. Wildcard caller (getPermissions returns ["*"]) granting "*" and arbitrary scopes. Expect success and a write with the parsed list.
7. ManageGuild caller granting "*". Expect success, and getPermissions not called.
8. Success for a caller who holds the scopes. Expect the exact success text and write args (guildId, target id, permissions, caller id). Also whitespace and case normalisation (" XP , Logging " becomes ["xp","logging"]).
9. Service throws AppError (e.g. ADMIN_NOT_FOUND for update). Expect the error embed with err.message. A non-AppError is rethrown.
10. Pre-check: a non-ManageGuild caller without the "managers" permission gets "You don't have permission to manage guild managers." and no further calls. Also an empty permissions string ("") gives Invalid permissions: `` (empty).
11. Optionally a regression guard for the service: GuildAdminService.addAdmin and updatePermissions with an invalid scope throw VALIDATION_ERROR with the service message (defence in depth stays), and updatePermissions on a missing user throws ADMIN_NOT_FOUND.
Confirm all pass on the unmodified code, then refactor, then re-run unchanged. Also run tsc/typecheck and lint for apps/bot."

### P2
**Dashboard sidebar uses plain <a href>, so every click reloads the layout and reruns /api/guilds and /api/auth**

Impact **medium** (the finder said high) · Effort **S** · Category performance

Locations: `apps/web/src/app/dashboard/layout.tsx:42`, `apps/web/src/app/dashboard/layout.tsx:68`, `apps/web/src/app/dashboard/layout.tsx:113`, `apps/web/src/app/dashboard/layout.tsx:128`, `apps/web/src/app/dashboard/layout.tsx:138`, `apps/web/src/app/dashboard/layout.tsx:148`, `apps/web/src/app/dashboard/layout.tsx:158`, `apps/web/src/app/dashboard/layout.tsx:170`, `apps/web/src/app/api/auth/route.ts:51`

**What the code does.** All sidebar navigation uses anchor tags, so each click is a full document load; the client layout remounts and its useEffect reruns /api/guilds (P1) and GET /api/auth (1 DB query + 1 Discord GET /users/{id}). P1's cost is therefore paid on every page change, not once per session.

**Verifier's notes.** The core claim holds. apps/web/src/app/dashboard/layout.tsx is a client component. Every sidebar link at lines 68, 113, 128, 138, 148, 158 and 170 is a plain <a href>. The only next/link import in apps/web/src is in leaderboard/page.tsx. Because of that, every sidebar click is a full document load. The layout remounts, and its mount-only useEffect (lines 42-57, deps []) fetches both /api/guilds and /api/auth again.

GET /api/auth (route.ts:51) costs one DB query, the jwtInvalidBefore lookup in getAuthenticatedUser, plus one uncached Discord GET /users/{id} through getDiscordUser. The cached resolveDiscordUser is not used here.

/api/guilds is expensive and has no cache:
- It makes 2 DB queries.
- It then runs up to 20 sequential checkGuildPermission calls. Each makes 1-2 Discord calls and may add a DB query, followed by isGuildMember for non-admins.
- It ends with one GET /guilds/{id} per accessible guild for the icon.
- Nothing in lib/discord.ts caches these calls, and there is no revalidate or fetchCache config. Next 16 does not cache fetch by default.

So P1's cost is paid on every page change, as the finding says. The proposed fix (next/link with the same href and className) is accurate, and the pathname-keyed mobile-menu effect would keep working.

I lowered the impact from high to medium. This issue multiplies P1's cost but is not an independent problem. The page content does not wait on the sidebar fetch, which only shows a skeleton. The dashboard is a low-traffic admin tool. The fix also leaves the first-load cost unchanged. The real risks are extra Discord API load on the shared bot token and slower navigation.

**Fix plan.** Not strictly 100% identical: swapping <a> for <Link> inherently changes when the layout's fetches run. A behavior-preserving version exists if the user-visible outcomes are kept, via two options.

Option A (recommended, closest to current behavior): in apps/web/src/app/dashboard/layout.tsx, import Link from "next/link" and replace the 8 anchors (profile at line 68, guild row at 113, Settings 128, Schedules 138, YouTube 148, Suggestions 158, Leaderboard 170) with <Link href=... className=...> keeping every href and className expression byte-identical (note the guild-row href ternary on isAdmin). Add prefetch={false} to avoid extra background requests (the prefetched RSC payloads are cheap, but the pages are all "use client" and dynamic). Then add `pathname` to a second effect that re-runs the cheap auth/guild freshness check on navigation, OR accept the staleness. To preserve the "stale session -> redirect to /" and "fresh guild list" outcomes exactly, rerun the two fetches on pathname change (this keeps behaviour but loses most of the perf win: it removes only the full document/JS/CSS reload and the loading-skeleton flash, which is still the main cost). Keep loadingGuilds from flipping back to true on refetch (current code shows skeleton on every click because of remount; decide whether to keep).

Option B (full perf win, needs Kevin's approval): plain Link swap with the fetch effect left as `[]`. Guild list, admin flags and user card refresh only on hard reload. Auth expiry is still caught because each page does its own fetch and redirects on 401 (settings page.tsx:531, youtube:54, leaderboard:28, profile:137, schedules:94, suggestions:41).

Files touched: apps/web/src/app/dashboard/layout.tsx only. Do not touch api/auth/route.ts (GET at line 51 stays as is). The logout button and the 401 handler legitimately keep window.location.href (hard reload is wanted there to clear state).

**Behaviour to keep the same.** 1) Staleness: with Option B, guilds, isAdmin (which gates Settings/Schedules/YouTube/Suggestions links and the guild-row target), guild name/icon, and user avatar/name no longer refresh per click. If a user's admin permission changes or the bot joins/leaves a guild, the sidebar stays wrong until reload. 2) Logout/revocation: today every click re-hits /api/auth and /api/guilds, so a revoked or expired session redirects to "/" at the sidebar click (layout.tsx:46). With Link, only the destination page's own fetch catches the 401; all six pages do handle 401 so the end result is the same, one request later. 3) Loading skeleton: currently shows on every nav (remount); with Link it shows only once. Visual change, arguably intended. 4) Component state now persists across navigations: mobileMenuOpen is reset by the pathname effect (lines 60-62), which still works, but the first-render effect would fire setState on same value. Sidebar scroll position and the mobile overlay now persist. 5) The layout `children` pages now unmount/mount via client routing, so any page-level module state, cached fetches, window scroll position, or useEffect-on-mount logic that assumed a fresh document load may behave differently (pages with their own useEffect([guildId]) are fine; verify page.tsx under [guildId] when guildId param changes between servers since the same page component instance may be reused and stale local state like settings/forms can leak across guilds unless effects reset on guildId). This is the most significant hidden risk: check that each page resets state when params.guildId changes (switching from guild A to guild B at the same route e.g. /server/A -> /server/B keeps the same page component mounted). 6) Active-link logic uses usePathname, which updates on client nav, so highlighting still works; startsWith(`/dashboard/server/${guildId}`) is unchanged. 7) Prefetching: Link prefetches in viewport in production by default, which adds background requests; use prefetch={false}. 8) CSP: no change needed (connect-src 'self'). middleware.ts rate limiting applies per request, so fewer requests helps. 9) Link does not full-reload on same-URL click; the old anchor re-fetched data on a click of the current page (a de facto refresh). Also middle/ctrl-click open-in-new-tab behaviour is preserved by Link. 10) Dev-only: client navigation changes Next dev overlay and HMR behaviour; no impact in prod.

**Tests.** Existing coverage: none. The only tests in the repo are in apps/bot/tests (vitest-style bot tests); apps/web has no test files, no test script, and no e2e/Playwright setup, and the dashboard layout has no unit coverage. Characterization tests to add before changing: (1) Component tests (add vitest + @testing-library/react + jsdom to apps/web, mocking next/navigation usePathname and global fetch) for DashboardLayout asserting: renders skeleton while /api/guilds pending; 401 from /api/guilds sets window.location.href="/"; admin guild shows Settings/Schedules/YouTube/Suggestions/Leaderboard links with exact hrefs; non-admin guild row href points to /leaderboard and shows only Leaderboard; active class applied for each pathname (profile, guild root, schedules, youtube, suggestions, leaderboard); guild row active via startsWith; mobile menu closes when pathname changes; user card shows display_name, then username, then "User"; Log out issues DELETE /api/auth then navigates to "/". (2) Snapshot of all href and className strings so the swap proves they are unchanged. (3) A fetch-call-count test asserting /api/guilds and /api/auth are called once on mount, and, after the fix, still once (Option B) or once per pathname change (Option A) across simulated pathname rerenders. (4) A manual or Playwright smoke test: log in, click through profile -> guild A -> schedules -> guild B and confirm no full document reload (performance.navigation / a window marker survives), network panel shows a single /api/guilds and /api/auth, active highlighting is right, and switching guild A to guild B on the same route shows B's data, not A's (state-leak check for item 5). (5) Expired-cookie test: clear cookie, click a sidebar link, confirm redirect to "/" occurs (via the page-level 401 handlers) under Link navigation.

### P4
**XP flush can mark entries clean that changed during the flush, losing their latest counts**

Impact **medium** (the finder said medium) · Effort **S** · Category performance

Locations: `apps/bot/src/services/xp.service.ts:97`, `apps/bot/src/services/xp.service.ts:219`, `apps/bot/src/services/xp.service.ts:233`, `apps/bot/src/index.ts:231`

**What the code does.** flushInternal snapshots dirty entries into batchUpsert (220-228), awaits it chunk by chunk (219), then sets entry.dirty=false for every collected entry (233-235). processMessage keeps mutating the same objects and setting dirty=true (97-98) during the await, and those changes are cleared without being written. The SIGTERM flush (index.ts:231) then skips them, so they are lost unless the user sends another message. This is a data-loss bug in the persistence path.

**Verifier's notes.** I could not refute the core claim; the code confirms it. In xp.service.ts, flushInternal collects references to the live XpEntry objects (lines 203-207). Each chunk's row values are built just before that chunk's batchUpsert call (lines 219-228). After every chunk has been awaited, it sets dirty=false on all collected entries (lines 233-235) without checking whether they changed in the meantime. While those awaits are pending, the event loop keeps running processMessage, which mutates the same objects in place and sets dirty=true (lines 97-98, 109-111). resetUser (172-177) and resetAllInMemory (296-301) also mutate in place. Those later changes are marked clean without ever being written. The SIGTERM flush (index.ts:231) skips clean entries, so they are lost on restart.

Corrections to the finding:
1. rehydrateGuild is not affected. It replaces map entries with new objects (xpMap.set at line 311), so the flush never clears those, and adding a version counter there is unnecessary.
2. The category should be correctness or data-integrity, not performance.
3. The common case heals itself. The user's next message marks the entry dirty again, and the next flush writes the full current totals, so only users who send nothing more before a restart lose data. That is usually a few messages' worth of counts or XP.

There is a worse case the finding does not mention. An admin can run resetUser or resetAllInMemory (xp-admin.ts:104 and :191) while a periodic flush is in flight. If the old values were already written and the reset entry is then marked clean, the reset is never persisted and comes back after a restart. The follow-up flush() after resetAll (xp-admin.ts:194) does not help here: it returns early with "Flush already in progress, skipping" when it overlaps that flush. The window is only as long as one DB round trip, so this is uncommon, but it is real.

There are no xp.service tests. The proposed fix (a version counter checked at snapshot time) is sound and small.

Impact: medium is defensible because of the reset case; the message-count loss alone would be low.

**Fix plan.** The bug is real. flushInternal collects dirty entries, then awaits repo.batchUpsert once per 500-row chunk. processMessage, resetUser, resetAllInMemory and rehydrateGuild can run in those awaits. After the last chunk, the loop at lines 233-235 sets dirty=false on every collected entry, including ones that changed after their chunk's values were read.

Only apps/bot/src/services/xp.service.ts changes, plus a new test file. Steps:

1. Add `version: number` to XpEntry. Initialise it to 0 in hydrate and in the new-entry literal in processMessage. In rehydrateGuild, which creates fresh objects, set version to 0 and dirty to true.
2. Increment `entry.version++` wherever `dirty = true` is set: processMessage (line 98), resetUser, resetAllInMemory. Only line 98 needs it in processMessage, because the cooldown and XP-grant mutations that follow are synchronous with it.
3. In flushInternal, record the version at the moment each chunk's row values are read, not at the initial collection pass. Chunks are built after earlier awaits, so values read at chunk-build time can be newer than a version captured at collection time. Use one synchronous step per chunk that builds `rows` and a parallel `versions` array from the same entry read. After `await batchUpsert(rows)` succeeds, for each entry in that chunk set `dirty=false` only if `entry.version === recordedVersion`. Doing this per chunk, instead of in one final loop, also means a failure on chunk N no longer leaves chunks 0..N-1 marked dirty and rewritten next time.
4. Keep the `count` in the 'XP data flushed' log as the number of entries collected. If you want to report entries actually cleaned, add a separate field. Keep the existing message text.
5. Leave the SIGTERM and uncaughtException paths unchanged. They call flush() as before and will now pick up the retained dirty entries.

An alternative with no version field is to clear dirty at chunk-build time and re-set it on failure. It is more fragile, because the failure path must restore dirty for every entry in every unwritten chunk. The version counter is preferred.

Check where else XpEntry objects are constructed (for example tests or xp-admin.ts) so the new required field compiles. Making it `version = 0` through a small `newEntry()` helper would also remove the duplicated literals.

**Behaviour to keep the same.** - Rows written for any given snapshot are identical. The only difference is that an entry changed during the flush stays dirty, so the next flush writes it. Dirty-entry counts in getStats and the debug log can be higher right after a flush than before.
- The 'XP data flushed' info log fires on success only. Keep the count semantics (entries collected) so log consumers see no change.
- A failure on a middle chunk currently leaves all entries dirty, including chunks that were already written. With per-chunk clearing, written chunks become clean. The next flush writes fewer rows, which is idempotent and correct, but it is a visible change. If strict parity is wanted, keep one clearing loop at the end but compare versions recorded at chunk-build time.
- getGuildEntries spreads `{...entry}`, so the version field leaks into the copies used by getRank and getLeaderboard. They only read specific fields, so nothing changes. getGuildSnapshot also maps specific fields, so the archive format is unaffected.
- rehydrateGuild replaces map objects. A flush in flight holds the old object, and clearing its dirty flag is harmless. The new object has dirty=true with version 0 and is picked up on the next flush. Do not reuse the old object's version number, or an in-flight flush could clear the new entry.
- If hydrate() ever ran after startup, replacing objects has the same orphaning property. It is only called once, so no change.
- The isFlushing guard and the timer logic must stay untouched. A skipped concurrent flush still logs the warning.
- Shutdown deadline: an extra dirty entry adds at most one more chunk write inside the 8s deadline in index.ts. This is negligible.

**Tests.** Existing coverage: none for xp.service. apps/bot/tests/services has guild, honeypot, logging and moderation tests, but nothing for XP, and there are no tests for xp.repository either. The existing tests use vitest with mocked repositories, so follow that pattern with a fake XpRepository and a stub pino Logger.

Characterization tests to add first, before any change, in apps/bot/tests/services/xp.service.test.ts:
1. processMessage grants XP on the first message, returns null inside the cooldown, and still increments messageCount during cooldown. Use fake timers and mock randomXp, or set xpMin equal to xpMax.
2. Level-up detection.
3. flush() upserts exactly the dirty rows, including the lastMessageAt null-versus-Date mapping, then marks them clean. A second flush with no changes is a no-op (batchUpsert not called).
4. Chunking at 500: 1001 dirty entries produce 3 batchUpsert calls with sizes 500, 500 and 1.
5. When batchUpsert rejects, entries stay dirty and flush() rethrows. isFlushing resets afterwards.
6. A second flush() while one is in progress is skipped.
7. resetUser, resetAllInMemory, rehydrateGuild and getGuildSnapshot behave as before: they mark dirty and produce the expected values.
8. getRank and getLeaderboard ordering.

Test for the fix, written to fail before the change and pass after:
- Use a deferred batchUpsert. Seed one entry and mark it dirty. Start flush(), and before resolving the deferred call run processMessage (and separately resetUser) for the same user. Resolve the deferred call. Assert getStats().dirtyEntries === 1, and that a second flush() calls batchUpsert again with the newer counts.
- Add a multi-chunk variant: mutate an entry belonging to chunk 2 while chunk 1 is awaiting, and verify the row written for chunk 2 reflects the newer values. This confirms versions are recorded at chunk-build time.
- Add a rehydrateGuild-during-flush case, to prove the new object stays dirty.

### P6
**Every guild-scoped API call pays sequential uncached Discord calls before the DB check; dashboard pages fan out and refetch the same guild**

Impact **medium** (the finder said medium) · Effort **S** · Category performance

Locations: `apps/web/src/lib/discord.ts:129`, `apps/web/src/lib/auth.ts:97`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:49`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:63`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:525`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:48`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:89`, `apps/web/src/app/dashboard/server/[guildId]/leaderboard/page.tsx:38`

**What the code does.** checkGuildPermission/getUserGuildPermissions (18 call sites) run strictly in sequence: JWT revocation DB read, GET /guilds/{id}, GET /members/{user}, then the guild_admins query. The YouTube page fires 3 such requests at once (same guild fetched 3 times); the settings page fires 2, and /discord then also fetches /guilds/{id}/roles although the permission check already had guild.roles. /discord also runs its own discordId-only guild_admins lookup (see D3). The leaderboard page calls the full /api/server/{id} only to set an isAdmin flag. No tests.

**Verifier's notes.** The core claims hold. In checkDiscordManageGuild (apps/web/src/lib/discord.ts:78-117), GET /guilds/{id} runs first and GET /members/{user} runs after it. checkGuildPermission (line 129) and getUserGuildPermissions both await that check before the guild_admins query. getAuthenticatedUser (auth.ts:97) adds a users-table revocation read before any of this. Nothing caches the guild or member calls; the only cache in the file is userCache, which is for resolveDiscordUser. There are 16 call sites outside discord.ts; the finding says 18, which is close enough. The YouTube page (lines 50-52) fires /youtube, /discord and /api/server/{id} at once. The settings page (lines 527-528) and the schedules page (lines 91-92) each fire two. The leaderboard page (line 38) calls the full /api/server/{id} only to call setIsAdmin. The /discord route also fetches /guilds/{id}/roles (line 63) after the permission check has already loaded guild.roles. It also runs its own guild_admins query filtered only by discordId with limit(1) (line 49). That lookup is a real bug: a user with entries in several guilds may fall back to the Discord check. The weak part is the size of the gain from fix (a). The guild_admins query is a single DB round trip that is small next to two Discord calls, so running it in parallel saves little latency. The larger cost is the repeated Discord calls per page load (3x GET /guilds/{id} on the YouTube page). Those use the bot's shared rate-limit budget, and a 429 fails closed as a 403, which users would see. Medium impact is defensible because of that 429 risk, not because of latency. Effort S is accurate.

**Fix plan.** All edits are in apps/web; nothing outside the web app is touched. Do the steps in order and keep each one separately revertible.

Step 1, lib/discord.ts. Extract a private helper `lookupGuildAdminPermissions(guildId, userId): Promise<string[] | null>`. It holds the existing guild_admins query (guildId and discordId, limit 1) inside its own try/catch. It returns `rows[0]?.permissions`, and on a DB error returns `[]` (what the current catch blocks produce).

Step 2, `checkGuildPermission`. Start both lookups before awaiting either:
- `const discordP = checkDiscordManageGuild(...)`
- `const dbP = lookupGuildAdminPermissions(...)`
- `if (await discordP) return true;`
- then apply the existing rules to `await dbP`: no row or empty permissions gives false; "*" gives true; no scope gives true; otherwise `includes(scope)`.

Start both promises before the first await so they actually overlap. `checkDiscordManageGuild` never throws (whole body in try/catch). The helper never rejects either, so the unawaited dbP cannot produce an unhandled rejection when Discord returns true early.

Step 3, `getUserGuildPermissions`. Same pattern: return `["*"]` if discordP is true, else `await dbP` (empty array when there is no row).

Step 4, /api/server/[guildId]/discord/route.ts (the D3 lookup). Add `and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, discordId))` and drop the `.some()` post-filter.
- `isCustomAdmin` becomes `adminRows.length > 0`.
- Keep the rule that any matching row grants access, even with empty permissions. Do not route this through `checkGuildPermission` yet.
- The change is a no-op except for the existing bug described in the risks section.

Step 5, optional, needs a separate decision. To reuse roles in /discord, `checkDiscordManageGuild` would have to return the guild, or a memo would have to be passed in. The check only runs when the user is not a custom admin, so the saving is one GET /roles in that case. Skip it unless Kevin wants it; I recommend not doing it. The /discord route also uses `@everyone` name filtering and role.color, which the guild payload's roles may not include in the same shape, so the payloads must be verified first.

Step 6, pages (the 'refetch the same guild' part). A behavior-preserving version is limited.
- YouTube page: its 3 requests (/youtube, /discord, /{guildId}) each pass their own permission check. Dropping the third and reading isYoutubeEnabled from another response would change API shapes, so leave it unless a new endpoint is approved.
- Leaderboard page: calling /api/server/{id} only to set isAdmin could be replaced by a lightweight `/permissions` endpoint. That is new API surface, so it is optional and not covered by the 'no functionality change' guarantee without approval.

Not in scope: the JWT revocation read in `getAuthenticatedUser` (auth.ts:97) stays sequential and first. Running it in parallel with the permission check would send Discord calls for revoked tokens. Cross-request caching of Discord permissions is out; it delays revocation and needs approval. The /api/guilds loop calling `checkGuildPermission` per guild gets the speedup automatically, but could also be batched with Promise.all separately.

**Behaviour to keep the same.** 1. Extra DB load: the guild_admins query now runs even for owners and Administrators, where today it is skipped. Results are identical; only load changes.
2. Precedence must stay as today: a Discord true wins, and the DB result is used only when Discord is false. Never combine them with OR on a thrown error, and never let a DB error turn a Discord true into false.
3. Both sides fail closed. Discord failures (non-ok, fetch error, timed-out member) return false. DB errors return false from `checkGuildPermission` and `[]` from `getUserGuildPermissions`. Keep the try/catch inside the helper so the early-returned promise never rejects unhandled.
4. Timed-out members: the Discord check returns false for Manage Server, but a custom admin row can still grant access. The same path must remain.
5. Scope semantics: empty permissions array gives false; "*" gives true; no scope gives true for any non-empty permissions; otherwise exact includes.
6. `getUserGuildPermissions` must return exactly ["*"] for Discord admins (PATCH /api/server/[guildId] uses the scopes), `[]` for no row, and the raw array otherwise.
7. /discord route, existing bug that Step 4 changes. Today the lookup is `where(discordId).limit(1)` with no guild filter, so for a user who is a custom admin in several guilds it returns an arbitrary row and `.some(r => r.guildId === guildId)` may miss. The request then falls back to `checkGuildPermission`, which does the DB check anyway. Result today: it is correct for rows with non-empty permissions. For a row with EMPTY permissions in this guild, the outcome is nondeterministic. It is granted if that row happens to be the one returned, and denied via checkGuildPermission otherwise. After the fix it is deterministically granted. This is the empty-permissions rule that must be kept unless Kevin approves otherwise. Flag this as a deliberate, tiny behavior tightening-to-deterministic, not a silent change.
8. Discord rate-limit and call counts are unchanged for Discord calls (still at most guild + member); only timing overlaps.
9. Error messages, status codes (401/403/404/500), and response bodies are untouched. The /discord 500 'Failed to fetch Discord data' path is unaffected.
10. Do not reorder `getAuthenticatedUser` before or alongside the permission check (revocation semantics).
11. Dashboard page changes (if any) can alter loading and error states, for example a 403 from one of the parallel requests now surfacing differently, so keep them out of the behavior-preserving scope.

**Tests.** Existing coverage: none for apps/web. The only tests in the repo are under apps/bot/tests; apps/web has no test script or test runner configured, and the root `test` is just `turbo test`. Adding any test means adding a runner (vitest is the natural choice, matching the bot's tests; check apps/bot/package.json) and a `test` script to apps/web. That is a small setup cost, about 15-20 minutes inside the S estimate, but it does change package.json and the lockfile, so get approval.

Characterization tests to write BEFORE refactoring (mock `./db`, `./env`, and global `fetch`; run them against the current code first, then the new code):
1. `checkGuildPermission` truth table, a matrix over {Discord owner / Administrator / Manage Server / timed-out Manage Server / none / guild fetch non-ok / member fetch non-ok / fetch throws} x {no row / row with [] / row ["*"] / row ["x"] / DB throws} x {scope omitted / matching / non-matching}.
2. `getUserGuildPermissions` over the same matrix: ["*"], [], or the raw array.
3. Precedence and failure: a Discord true returns true even when the DB throws; Discord failure plus a valid DB row still grants.
4. Call counts and ordering: Discord guild then member calls as today (owner skips the member call). After the change, assert that the DB query is issued without waiting for the Discord response (deferred-promise test).
5. /discord route: (a) custom admin with non-empty permissions for this guild gives 200 with no Discord permission calls; (b) no row falls back to the permission check, returning 403 when it fails; (c) multi-guild admin with rows for other guilds, run before and after the filter fix to confirm the same result; (d) an empty-permissions row in this guild is pinned as granted (the post-fix deterministic behavior), documented as the one intentional delta from item 7 under risks.
6. `getAuthenticatedUser` revocation (no user row, jwtInvalidBefore, iat) as a guard that it was left untouched.

Run `pnpm --filter web typecheck` and `lint` after each step; manually smoke-test the dashboard's server settings, YouTube, and leaderboard pages as an owner, a custom admin, and a non-admin.

### P7
**Logging handlers call Discord REST (message fetch, member fetch, audit log) before checking whether logging is enabled**

Impact **medium** (the finder said medium) · Effort **S** · Category performance

Locations: `apps/bot/src/events/message-update.ts:15`, `apps/bot/src/events/message-update.ts:33`, `apps/bot/src/events/guild-member-update.ts:12`, `apps/bot/src/events/guild-member-update.ts:22`, `apps/bot/src/events/guild-member-remove.ts:31`, `apps/bot/src/events/guild-member-remove.ts:41`, `apps/bot/src/client.ts:13`

**What the code does.** message-update fetches every partial message (15-21) before shouldLog('message_edit') at 33. guild-member-update fetches every partial old member (12-18) before shouldLog at 22/59 (and that fetch likely returns current state, so the diff finds nothing). guild-member-remove calls fetchAuditLogs on every non-honeypot leave (31) before shouldLog at 41/69. With Partials.Message and Partials.GuildMember (client.ts:13-17), servers with logging off still make rate-limited REST calls.

**Verifier's notes.** The finding holds up against the code.

- **message-update.ts:** lines 15-21 fetch a partial newMessage before line 33 checks `shouldLog('message_edit')`. The fetch also comes before the `editedTimestamp` check at line 27, so non-content updates on uncached messages, such as embed resolution, cost a REST call too.
- **guild-member-update.ts:** lines 12-18 fetch a partial oldMember before the `shouldLog` checks at lines 22 and 59. That fetch returns the member's current state, so the role and nickname diff finds nothing anyway. This is a correctness defect as well as wasted work.
- **guild-member-remove.ts:** line 31 calls `findRecentAuditLogEntry`, which calls `guild.fetchAuditLogs` with a limit of 10, on every leave that isn't a honeypot event. That happens before `shouldLog` at lines 41 and 69. `takeRemoveEvent` at line 11 runs before any await, so the fix can keep that ordering.
- **client.ts:** enables `Partials.Message` and `Partials.GuildMember`, which confirms the partial paths are reachable.
- **Nothing mitigates it:** `shouldLog` (logging.service.ts:20) only reads guild settings, which come from `guildService.getSettings` and are probably cached. Nothing gates these REST calls when logging is off.
- **Behaviour:** the proposed reorder keeps the same output whenever something is logged.
- **Tests:** guild-member-remove.test.ts asserts `fetchAuditLogs` call counts at lines 65, 88, 99 and 118. The new order should still satisfy them, provided the test's mocked `shouldLog` returns true.

Impact is medium. These are per-event REST calls on frequent gateway events (edits, member updates, leaves), and they count against rate limits in guilds that have logging turned off. The effort is small.

**Fix plan.** Three small edits in apps/bot/src/events, each hoisting the existing shouldLog check(s) ahead of the Discord REST call. The embed-building code is untouched.

1. message-update.ts. Keep the `!newMessage.guild` and `author?.bot` guards. Then call `shouldLog(guild.id, "message_edit")` once and return if it is false. After that comes the partial `newMessage.fetch()` (return on failure) and the existing edit-detection checks. Replace the later `if (await shouldLog(...))` wrapper with the stored boolean, or drop the wrapper and de-indent. This needs only guild.id, which is available on a partial message. The bot guard keeps running before the fetch, as it does today.

2. guild-member-update.ts. Before the `oldMember.partial` fetch, compute `roleOn = await shouldLog(guildId, "role_change")` and `nickOn = await shouldLog(guildId, "nickname_change")`. If both are false, return. Otherwise run the fetch (return on failure) and the existing diff blocks. Gate each block on its stored boolean in place of the inline shouldLog call. Keep the `roles.cache.size` and `nickname` comparisons as they are. If you want to avoid a second settings lookup, only compute nickOn when roleOn is false. The simple form is fine because shouldLog reads cached guild settings.

3. guild-member-remove.ts. Keep `takeRemoveEvent` on line 11 as the first statement, before any await, and keep the honeypot "ban" early return. Then `leaveOn = await shouldLog(guildId, "member_leave")` and `kickOn = await shouldLog(guildId, "kick")`. In the non-honeypot-kick branch, call `findRecentAuditLogEntry` only if `leaveOn || kickOn`. Otherwise return, since nothing can be logged and `action` is only used by the two log blocks. Use leaveOn for the "Member Left/Kicked" block and `action === "kicked" && kickOn` for the Kick block. The honeypot-kick path (hp.action === "kick") needs no audit lookup and stays as is.

4. Before changing the handlers, add the tests below. Run `pnpm --filter bot test` (vitest) and typecheck afterwards.

**Behaviour to keep the same.** - Ordering in guild-member-remove: takeRemoveEvent must stay the first statement, before any await. It is a one-shot read of a record that expires, so awaiting first would break the honeypot guarantee. The new shouldLog awaits must come after it.
- The honeypot "ban" early return must stay before any shouldLog call or audit fetch. The existing test asserts that fetchAuditLogs is not called.
- shouldLog("kick") is currently called only when action === "kicked". Hoisting it adds a settings lookup on plain leaves. The existing tests only use toHaveBeenCalledWith, not call counts or not-called checks, so they will not notice. Confirm that guildService.getSettings is cached or cheap. If you want zero extra calls, compute kickOn lazily only when leaveOn is false.
- Settings can change between the early check and the later send. The window is a few ms, and sendLogEmbed re-reads logChannelId anyway.
- message-update: the bot check uses newMessage.author?.bot BEFORE the partial fetch, so a partial message from a bot that has not been fetched passes the guard and still logs today. Do not move or "fix" that, because it would change behavior. shouldLog is a pure settings read, so moving it ahead of the fetch and the editedTimestamp/content checks changes nothing about outputs.
- guild-member-update: GuildMember.fetch() on a partial refreshes the cached member in place. Skipping it when both log types are off leaves that cache entry un-refreshed. Nothing in the bot reads it for this purpose, and the gateway event already patches newMember. Where fetch returns current state, the diff finds nothing, so output is the same either way. Do not change that apparent bug in this refactor.
- Keep the fetch-failure behavior (silent return) and the log-embed contents byte-identical. Do not reorder log blocks: Member Left/Kicked comes before Kick.
- Logging is not observable when the settings are off, so the only observable change is fewer REST calls.

**Tests.** Existing: apps/bot/tests/events/guild-member-remove.test.ts covers the honeypot kick (no fetchAuditLogs), the honeypot ban (no embeds, no fetch), and ordinary leave/kick with fetchAuditLogs called once. It mocks shouldLog as always true. There are no tests for message-update.ts or guild-member-update.ts, so add characterization tests there first, while the current behavior is still in place.

Add before refactoring:
- guild-member-remove: shouldLog returns false for every type, plain leave. Assert fetchAuditLogs call count and that no embed is sent. Today the count is 1, so this pins the current behavior. After the fix, flip the expectation to 0 deliberately. Also add a case with member_leave false and kick true where the audit log holds a kick. Expect only the "Kick" embed and exactly one fetch. Add a case with member_leave true and kick false for a moderator kick. Expect only the "Member Kicked" embed. Also assert that takeRemoveEvent still clears the honeypot record when logging is off, for example that a second call returns undefined.
- message-update: (a) a non-partial edit with changed content and shouldLog true sends a "Message Edited" embed with the old and new content. (b) A partial newMessage with fetch resolving to an edited message and shouldLog true sends the embed. (c) The same with shouldLog false: pin fetch called today, then assert 0 after the fix. (d) A partial old message with editedTimestamp null sends nothing. (e) A fetch that rejects sends nothing. (f) A bot author on the new message returns early.
- guild-member-update: a role add or removal, a nickname change, a partial old member whose fetch returns the current state (no embed), a fetch rejection (no embed), and shouldLog false for both types (pin the fetch count today, then expect 0).

After the change, run the full bot vitest suite plus the typecheck.

### C1
**message-create.ts is an untested 3-feature god handler on the hottest path**

Impact **medium** (the finder said high) · Effort **M** · Category complexity

Locations: `apps/bot/src/events/message-create.ts:10`, `apps/bot/src/events/message-create.ts:23`, `apps/bot/src/events/message-create.ts:39`, `apps/bot/src/events/message-create.ts:57`, `apps/bot/src/events/message-create.ts:83`, `apps/bot/src/events/message-create.ts:89`, `apps/bot/src/events/message-create.ts:106`, `apps/bot/src/services/xp.service.ts:82`

**What the code does.** One execute runs honeypot (17-20), the intro gate (23-80, nested 4 deep) and XP (83-129, nested 4 deep) inline. It looks up the member twice (members.fetch at :39 ignores message.member; the XP block fetches again at :89). Hidden flow: a rejected intro is deleted (:57) and the user DM'd, then control falls through to XP, so the deleted message still earns XP and can post a level-up. xpExcludedChannelIds/xpExcludedRoleIds are passed to processMessage (:106-107) but never read. No test file.

**Verifier's notes.** The core claims check out against apps/bot/src/events/message-create.ts.
- One execute runs three features inline: honeypot and late-delete (17-20), the intro gate (23-80) and XP (83-129).
- A rejected intro is deleted (:57) and the user is DM'd. Nothing returns early, so control falls into the XP block. The deleted message can still earn XP and post a level-up embed.
- processMessage in xp.service.ts (~:82-120) receives xpExcludedChannelIds and xpExcludedRoleIds but never reads them.
- There is no test file for message-create or for XP. The only related test is tests/utils/intro-validator.test.ts.

Two parts are overstated:
- "Looks up the member twice": the intro gate calls members.fetch(author.id) and ignores message.member. The XP block uses `message.member ?? fetch`, so it normally makes no second fetch. members.fetch without force also returns the cached member, so neither call usually costs an API round trip.
- "Hottest path": the handler is mostly cheap. The XP path works in memory, and getSettings is presumably cached. The cost is maintainability and risk, not performance.

The module is about 130 lines, which is moderate rather than a god handler. The real value of the finding is the hidden fall-through behaviour, the dead settings fields and the missing tests on a handler every message passes through. I rate it medium, not high.

**Fix plan.** Verified against apps/bot/src/events/message-create.ts. The proposed fix is sound and behavior-preserving if the blocks are moved verbatim.

Step 0, characterization tests first (new file apps/bot/tests/events/message-create.test.ts), run green against the unchanged handler.

Step 1, create apps/bot/src/lib/intro-gate.ts exporting `runIntroGate(message: Message<true>, guild: GuildSettings, ctx: BotContext): Promise<void>`.
- Move lines 23-80 verbatim: the 4-part enable/channel condition, validateIntroduction, the valid branch, and the reject branch.
- The function has no return value and no early return. Falling off the end is what preserves XP-after-rejection.
- Keep `members.fetch(message.author.id)` and do NOT swap it for message.member.
- Keep the try/catch boundaries exactly as they are:
  - role-assign try wraps the fetch, the roles.cache check, roles.add and the info log.
  - delete try is separate.
  - DM try wraps EmbedBuilder construction AND author.send.
  - originalContent truncation (1000 chars plus "...") sits outside any try.
- Keep the log messages, log fields and DM embed text identical.

Step 2, create apps/bot/src/lib/xp-award.ts exporting `awardXp(message: Message<true>, guild, ctx): Promise<void>`.
- Move lines 83-129 verbatim. The inner `return`s become function returns, which is equivalent because XP is the last step.
- Keep the order: isXpEnabled, then excluded-channel check BEFORE any member lookup, then the member lookup `message.member ?? await members.fetch(...)`, then the excluded-role check, then processMessage, then the level-up send.
- Keep the try/catch that returns silently on a failed fetch.
- Keep the level-up `channels.fetch` and `send` inside one try that warns "Failed to send level-up message".
- Keep EmbedBuilder construction outside that try.
- Keep `guild.xpLevelupChannelId ?? message.channel.id` (nullish, not `||`).
- Do not clean up the dead xpExcludedChannelIds/xpExcludedRoleIds fields in this refactor. They are part of the GuildXpSettings type (xp.service.ts:45-46). Removing them is a separate, approved cleanup.

Step 3, reduce execute to an ordered pipeline:
1. bot check
2. inGuild check
3. getSettings, return if null
4. handleHoneypotMessage, return if "handled"
5. deleteLateMessage, return if true
6. await runIntroGate
7. await awardXp
Keep the two early returns in execute because they must stop the intro gate and XP. Import the guild settings type from wherever guild.service defines it. Use `Message<true>` after the inGuild narrowing.

Step 4, run `pnpm --filter bot test`, `tsc --noEmit` and lint. Confirm the characterization tests pass unchanged, with no edits to assertions.

Files touched:
- apps/bot/src/events/message-create.ts (modified)
- apps/bot/src/lib/intro-gate.ts (new)
- apps/bot/src/lib/xp-award.ts (new)
- apps/bot/tests/events/message-create.test.ts (new)
No change to the event loader is needed, because it loads events and the lib files are plain imports.

Separate decision for Kevin, not part of the refactor: whether a rejected intro should earn XP. Not changing this is the default.

**Behaviour to keep the same.** 1. Early return after intro rejection. Adding one stops the deleted message earning XP and posting a level-up. This is the key hidden flow, and it must be kept.
2. Using message.member in the intro gate. members.fetch(id) in the intro gate and `message.member ?? members.fetch` in XP behave differently when message.member is null or partial. Do not unify them, and do not hoist one shared member lookup. A shared lookup would also change when fetch errors are thrown or swallowed: the intro gate warns, XP silently skips XP.
3. Ordering: honeypot, then late-delete, then intro, then XP. Late-delete and honeypot returns must remain in execute.
4. Excluded-channel check must run before any member fetch, so excluded channels cause no API call.
5. Error scoping. If the EmbedBuilder or DM construction moves outside the try, a throw would no longer be swallowed. The same applies to the level-up embed, which is currently outside the try (a throw there propagates out of execute), while channels.fetch and send are inside it.
6. The extracted XP code must not early-return before awardXp when the intro gate rejects.
7. `??` vs `||` on xpLevelupChannelId. An empty string would behave differently.
8. Sync vs async. processMessage is synchronous and increments messageCount even on cooldown. Keep it called exactly once per message that reaches it. A double call would double-count.
9. Log message strings and structured fields. Tests or ops may rely on them.
10. Awaiting runIntroGate and awardXp. Unawaited calls would change ordering and error propagation.
11. The unused xpExcludedChannelIds/xpExcludedRoleIds settings fields must keep being passed (or the type left alone) to avoid a type error. Do not remove them as part of this refactor.

**Tests.** Existing coverage: there is NO test for message-create.ts, and none for xp.service.ts (processMessage, hydrate and so on). Related tests that do exist:
- apps/bot/tests/utils/intro-validator.test.ts covers validateIntroduction only.
- apps/bot/tests/lib/honeypot-enforcer.test.ts covers handleHoneypotMessage and deleteLateMessage in isolation.
These do not exercise the handler's wiring.

Add apps/bot/tests/events/message-create.test.ts, modelled on apps/bot/tests/events/guild-member-add.test.ts (a setup() factory with vi.fn mocks cast to BotContext). Mock ../../src/lib/honeypot-enforcer.js with vi.mock. Use the real validateIntroduction, or mock it for determinism. Cases:
1. Bot author, or non-guild message: nothing is called, including getSettings.
2. getSettings returns null: return, no other calls.
3. Honeypot returns "handled": no intro, no XP, no processMessage call.
4. deleteLateMessage returns true: same.
5. Order: honeypot and late-delete are called before the intro gate (use mock call order).
6. Valid intro in the intro channel, role missing: members.fetch called, roles.add(introRoleId) called, info log.
7. Valid intro, role already present: roles.add not called.
8. Valid intro, fetch or add rejects: warn "Failed to assign intro role", no throw.
9. Intro gate disabled, or any of introChannelId/introRoleId unset, or a different channel: validator and member fetch are not invoked.
10. Invalid intro: message.delete called, author.send called with an embed (title "Introduction Not Accepted", description containing result.reason and `<#introChannelId>`, field "Your message", "(empty)" for empty content, truncated to 1000 chars + "..." for long content), AND xp.processMessage is still called (characterizes the XP-after-rejection flow).
11. Invalid intro, delete rejects: warn is logged, DM still attempted, XP still runs. DM rejects: warn is logged, XP still runs.
12. XP disabled: processMessage is not called.
13. XP in an excluded channel: no member lookup and no processMessage.
14. XP with an excluded role on message.member: no processMessage.
15. message.member null: falls back to members.fetch. If the fetch rejects, return silently with no processMessage.
16. processMessage returns null (cooldown): no level-up send.
17. Level-up with xpLevelupChannelId set: channels.fetch(thatId), send an embed containing the displayName and "Level N". Unset: falls back to message.channel.id. A non-text-based channel gets no send. A fetch or send rejection warns "Failed to send level-up message".
18. processMessage is called with (guildId, authorId, the five xp settings including the excluded arrays).
Also add a small xp.service.test.ts for processMessage (cooldown counts the message but grants no XP, level-up detection). It is optional but cheap and de-risks the later dead-field cleanup.

The new tests must pass against the original code before any extraction, and pass unmodified after. Run `pnpm --filter bot test`, typecheck and lint after each extraction step.

### C2
**xp-admin.ts: 285-line execute holding archive/reset/restore workflows, direct repository access, and duplicated guards/types**

Impact **medium** (the finder said high) · Effort **M** · Category complexity

Locations: `apps/bot/src/commands/xp-admin.ts:65`, `apps/bot/src/commands/xp-admin.ts:116`, `apps/bot/src/commands/xp-admin.ts:137`, `apps/bot/src/commands/xp-admin.ts:155`, `apps/bot/src/commands/xp-admin.ts:172`, `apps/bot/src/commands/xp-admin.ts:175`, `apps/bot/src/commands/xp-admin.ts:212`, `apps/bot/src/commands/xp-admin.ts:220`, `apps/bot/src/commands/xp-admin.ts:253`, `apps/bot/src/commands/xp-admin.ts:267`, `apps/bot/src/commands/xp-admin.ts:269`, `apps/bot/src/commands/xp-admin.ts:275`, `apps/bot/src/commands/xp-admin.ts:310`, `apps/bot/src/services/xp.service.ts:279`, `apps/bot/src/services/xp.service.ts:309`, `apps/bot/src/repositories/xp-archive.repository.ts:17`

**What the code does.** One switch holds 6 subcommands. reset-all (flush -> snapshot -> archive -> zero -> flush, :155-198) and restore (validate -> flush -> auto-archive -> rehydrate -> flush -> markRestored, :247-297) live in the command and reach the repository via ctx.xpArchiveRepo (8 sites, against AGENT.md), needing 3 copies of the 'Archive system not available' guard. Both branches repeat the Administrator check, CONFIRM check and snapshot.reduce(sum totalXp) + xpArchiveRepo.create(...). The snapshot entry type is inlined 4 times though XpArchiveSnapshotEntry exists. Archive validation breaks inside a for inside a switch then checks entries.length !== rawData.length (:254-269). status sorts the whole guild with getLeaderboard(9999) only to count. lastFlushAt is module-level state. XpService.flush() returns silently while another flush runs, so the 'flush zeros now' step at :195 can do nothing. No tests.

**Verifier's notes.** The core claims check out. In apps/bot/src/commands/xp-admin.ts, execute runs from :65 to :349 (about 285 lines) and one switch holds 6 subcommands. reset-all (:137-210) and restore (:212-307) run their flush, snapshot, archive and rehydrate steps inside the command. There are exactly 8 ctx.xpArchiveRepo sites (:175, 180, 220, 241, 276, 297, 310, 315), and the 'Archive system not available.' guard appears 3 times. The Administrator check, the CONFIRM check and the reduce + create pair are each repeated in both branches. The snapshot entry type is written out inline at :253 and :267 and twice in xp.service.ts (:279, :309), although XpArchiveSnapshotEntry exists at xp-archive.repository.ts:17. The validation loop breaks out of a for loop and then compares entries.length to rawData.length (:254-269). status calls getLeaderboard(9999) just to count users. lastFlushAt is module-level state. XpService.flush() logs a warning and returns early when isFlushing is set (:188-191). There are no xp tests under apps/bot/tests.

Two caveats. First, AGENT.md:94 documents xpArchiveRepo on the context, and its rule at :63 forbids importing repositories, which the command does not do. So the layering complaint is a breach of the layering intent, not of the literal rule. Second, a skipped flush does not lose data. The snapshot is read from memory, and entries that were zeroed or rehydrated stay dirty until the next periodic flush. The only effect is that persisting them is delayed.

On impact: this is a rarely used admin command, the complexity stays inside one file, and no bug comes from it. Its weight comes from the lack of tests on destructive XP operations. Medium fits better than high.

**Fix plan.** Verified against code: xp-admin.ts execute is 285 lines (65-349); the 'archive not available' guard appears 3 times (176, 221, 311); the snapshot-entry type is inlined at :253, :267, xp.service.ts getGuildSnapshot (:279) and rehydrateGuild (:309); XpArchiveSnapshotEntry exists at xp-archive.repository.ts:17; ctx.xpArchiveRepo is optional in types/context.ts:46 and set in index.ts:90/114. flush() skip-while-flushing is at xp.service.ts:187-191. No existing tests for xp-admin or xp service.

Do it in 3 independently shippable steps, each a pure refactor.

Step 0 (tests first, see testsNeeded).

Step 1 (types/helpers, lowest risk, S): replace the 4 inline entry types with `XpArchiveSnapshotEntry` (type-only import; types are structurally identical, so zero runtime change). Extract pure `parseArchiveEntries(raw: unknown): {ok:true,entries}|{ok:false,reason:'not-array'|'invalid-entry'}` into e.g. apps/bot/src/utils/xp-archive.ts. Distinguish the two failure messages ('(not an array)' vs '(invalid entry format)'); the current for/break/length-compare logic is equivalent to 'return on first invalid entry', so the replacement is exact. Add `isAdministrator(interaction)` and `archiveUnavailable(interaction)` helpers in the command file that keep the exact embed strings. Add private `snapshotTotal(snapshot)` for the duplicated reduce.

Step 2 (command shape, S/M): replace switch with `Record<string, (interaction, ctx, guildId)=>Promise<void>>` handler map, each handler a function that `return`s where the switch used `break`. Keep the single outer try/catch (AppError -> err.message; else log with {err, sub} and 'Something went wrong.') around the dispatch, and keep the guildId and ManageGuild/xp-scope pre-checks and `lastFlushAt`/cooldown state unchanged in the flush handler (module-level state can stay; moving it is optional and must still be shared per process). status: add `XpService.guildEntryCount(guildId)` counting keys with the `${guildId}:` prefix. Check getLeaderboard to confirm it does not filter anything (e.g. zero-XP, left members, limit/filter) before swapping; if it filters, the count method must replicate that filter exactly, otherwise the number shown changes.

Step 3 (service extraction, M): create `XpArchiveService(repo: XpArchiveRepository, xp: XpService, logger)` with `resetAll({guildId, userId, reason})`, `restore({guildId, userId, archiveId, confirmed...})`, `list(guildId)`, returning tagged results (e.g. {kind:'ok'|'flush-failed'|'empty'|'invalid-uuid'|'not-found'|'corrupt-not-array'|'corrupt-entry', ...}). The command keeps ALL Discord-facing checks and ordering (Administrator, CONFIRM, option reading) and maps tags to byte-identical embed text. Wire in index.ts and BotContext as `xpArchive` service; remove the optional `xpArchiveRepo` from ctx only after confirming nothing else uses it (grep shows only xp-admin does). Decision point: `xpArchiveRepo` is optional on ctx, so 'Archive system not available' arises when ctx lacks it. If the service becomes always-constructed in index.ts the guard becomes unreachable and that user-visible path disappears; to be strictly behavior-preserving either keep `xpArchive?: XpArchiveService` optional with the same three guards (at the same positions in the order) or document the guard as dead and get approval. Recommend keeping it optional in the first pass.

Do NOT change XpService.flush() semantics; the 'flush zeros now' no-op during a concurrent flush is an existing latent bug (separate finding). Preserve it, add a characterization test documenting it, and fix it separately with approval.

**Behaviour to keep the same.** 1. Check order differs per branch and is user-visible; it must be preserved exactly. reset-all: Administrator -> CONFIRM -> flush (caught, abort message) -> snapshot empty ('No XP data found') -> repo availability (checked AFTER flush and snapshot, so with no repo the flush still happens and an empty guild reports 'No XP data' rather than 'Archive system not available') -> create -> resetAllInMemory -> flush (caught, logged only) -> success. restore: Administrator -> repo available -> CONFIRM -> trim archive_id -> UUID regex (case-insensitive) -> findByIdAndGuild -> not-array -> invalid-entry -> flush (NOT caught, so failure goes to outer catch: AppError message or 'Something went wrong.', no 'aborted' message) -> auto-archive only if snapshot non-empty -> rehydrate -> flush (caught) -> markRestored -> success. archives: repo available -> findByGuild(guildId,10) -> empty info -> `!interaction.guild` check happens AFTER the DB query and empty check -> members.fetch. Note restore and reset-all differ in where the repo guard sits; a naive shared helper would reorder them.
2. Wrapping restore's first flush in try/catch (as reset-all does) would change the failure message and, importantly, would proceed to overwrite data; keep it uncaught.
3. A partially-failed restore currently leaves state mid-way (auto-archived, rehydrated in memory, markRestored never called if the second flush... actually the second flush is caught, but markRestored errors propagate to the outer catch after in-memory rehydration happened). Service errors must propagate identically (not be converted into result tags) so the outer catch still maps AppError -> message, others -> 'Something went wrong.' and logs `{err, sub}` with the command-level logger.
4. Logging: child logger fields {command:'xp-admin', sub, guildId[, archiveId]} and message strings/levels; moving to the service must keep the same fields (pass a child logger in or recreate it) so log queries do not break.
5. Embed text includes `toLocaleString()` of totals (locale-dependent) and `archiveId.slice(0,8)`; in restore the success text uses `archive.totalXpSum` (DB value), not the recomputed sum; reset-all uses the recomputed `totalXpSum` and `snapshot.length`. Keep each source.
6. Auto-archive reason string `Auto-archive before restore of ${archiveId.slice(0,8)}` and `reason ?? null` for reset-all must stay byte-identical; archives are stored via JSON.parse(JSON.stringify(data)) in the repository, which must not be bypassed.
7. flush(): the silent skip when isFlushing is true means 'flush' step guarantees are weaker than they look; do not 'fix' by awaiting, which changes timing and could deadlock/stall. The flush command checks `flushing` and a module-level 5-minute cooldown that is set BEFORE the flush (a failed flush still consumes the cooldown); preserve both, and note moving lastFlushAt into a per-instance field changes behavior only on bot restart/hot reload (no difference), but per-guild cooldown would change behavior (cooldown is currently global across guilds).
8. Replacing the for/break validation: the old code, on invalid entry, sent the reply and returned via `break` with no further work; the `entries.length !== rawData.length` line is only a sentinel for that. Empty array passes validation and proceeds to a restore of 0 users (it still auto-archives and rehydrates nothing, and shows 'Restored 0 users'); keep that.
9. status: getLeaderboard(guildId, 9999) caps at 9999 entries, so for a guild above 9999 users the displayed count is capped; guildEntryCount would report the true count (a visible, arguably-bug-fix change). Either replicate Math.min(count, 9999) or get approval. Also verify getLeaderboard has no filtering/sorting side effects.
10. TypeScript structural typing: getGuildSnapshot's return type being replaced by XpArchiveSnapshotEntry[] is safe; rehydrateGuild accepts the same shape. The discord.js `interaction.memberPermissions?.has(...) ?? false` semantics (undefined in DMs, though a guild check precedes) must be retained. The pre-check `ManageGuild` string vs `PermissionFlagsBits.Administrator` difference must be kept as is.

**Tests.** Existing coverage: none for xp-admin.ts, XpService, or XpArchiveRepository (tests live in apps/bot/tests/{commands,services,lib,events,utils,db}, vitest, `pnpm --filter bot test`; only commands/suggest.test.ts exists as a command test, which can serve as a mock-interaction template; tests/db/honeypot.test.ts as a template for repository tests).

Characterization tests to write BEFORE any refactor (apps/bot/tests/commands/xp-admin.test.ts using mock interaction with editReply spy, options getters, memberPermissions.has, and a fake ctx with xp service stubs recording call order, an xpArchiveRepo fake, and a logger fake with child()):
- Permissions gate: no guildId; neither ManageGuild nor xp scope; xp scope only.
- flush: in-progress message, cooldown message with remaining seconds (use fake timers; note module-level lastFlushAt requires vi.resetModules between tests), success, cooldown consumed even when flush throws.
- reset: user with/without data.
- status: counts incl. defaults when guild settings null; assert getLeaderboard-derived count (and cap at 9999 behavior if kept).
- reset-all: non-admin; wrong CONFIRM; flush throws -> abort text and no repo call; empty snapshot; repo missing; happy path asserting exact call order [flush, getGuildSnapshot, create(args incl. reason null/value, userCount, sum), resetAllInMemory, flush] and exact embed text with and without reason; second flush throws -> still success.
- reset-all with repo missing AND empty snapshot -> 'No XP data' (pins the ordering quirk).
- restore: non-admin; repo missing (checked before CONFIRM); wrong CONFIRM; invalid UUID; uppercase UUID accepted; archive_id with whitespace trimmed; not found; data not array; one invalid entry among valid ones (each field type wrong); empty array; first flush throws -> 'Something went wrong.' (AppError variant -> its message) and no rehydrate; happy path call order [flush, getGuildSnapshot, create(auto-archive reason string), rehydrateGuild(entries), flush, markRestored] and text; empty current snapshot skips auto-archive; second flush throws -> still marks restored; markRestored throws -> outer error.
- archives: repo missing; empty list; members not fetched ordering (guild missing after non-empty list); line formatting with and without restored and with archiver not in members.
- Outer catch: AppError vs generic error logging.
Service-level tests: XpService.getGuildSnapshot/resetAllInMemory/rehydrateGuild/flush-skip-while-flushing (fake db; documents that a second concurrent flush returns without writing) in tests/services/xp.service.test.ts. Add unit tests for parseArchiveEntries (table-driven, including null item, array item, NaN-valued numbers pass typeof check) when created.
After refactor, the same characterization suite must pass unchanged against the command (only the setup wiring may change to inject XpArchiveService), plus new XpArchiveService tests asserting tagged results; run `pnpm --filter bot test` and `pnpm --filter bot exec tsc --noEmit`. Also manually smoke-test /xp-admin reset-all and restore against a dev guild before merge since this is destructive XP data handling (use Opus-level review per the 'saving and money' rule; several independent reviewers recommended)).

### C3
**Server settings page is a 921-line god component with 8 UI primitives, a 260-line rich editor, a hand-duplicated settings type and safety-critical save-diff logic**

Impact **medium** (the finder said high) · Effort **M** · Category complexity

Locations: `apps/web/src/app/dashboard/server/[guildId]/page.tsx:6`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:70`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:142`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:556`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:593`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:685`, `packages/db/src/schema.ts:127`

**What the code does.** The file defines Toggle, ChannelSelect, RoleSelect, PlaceholderTextarea (142-402), TagInput, MultiSelect, EventPicker and Section plus the page. GuildSettings (6-49) re-declares GuildRow by hand. handleSave (556-638) has a manual whitelist of always-sent fields (562-591), honeypot change-only sending (593-602, which stops a stale tab re-arming the honeypot) and hasDiscordData-gated channel/role IDs (604-619). Adding a setting means editing the interface, the whitelist and the JSX; forgetting the whitelist silently drops the field. (Separately, not part of the refactor: handleSave has no try/finally, so a rejected fetch leaves the button stuck on Saving.)

**Verifier's notes.** The finding holds up against the code. apps/web/src/app/dashboard/server/[guildId]/page.tsx is 921 lines. It defines Toggle (70), ChannelSelect (85), RoleSelect (117), PlaceholderTextarea (142-~402), TagInput (404), MultiSelect (438), EventPicker (469) and Section (495), and then the page itself (506). GuildSettings (6-49) is written out by hand, separately from GuildRow (packages/db/src/schema.ts:127). handleSave holds a hand-written list of fields it always sends. It sends the honeypot enable flag and action only when they have changed, or sends all three when the honeypot is being turned on. It sends channel and role IDs only when hasDiscordData is true. The comments in handleSave say why each rule exists. There is no try/finally: if fetch rejects or res.json() throws, setSaving(false) never runs. apps/web has no tests (git ls-files finds only apps/bot/tests), and apps/web/src/components holds only cron-builder.tsx, so nothing has been extracted yet.

I would lower the impact to medium. This is one admin page, not a hot path. The save-diff logic is correct today and documented inline. Leaving a new field out of the list fails visibly, because the toggle reverts after save. The real risk is to maintenance. The proposed buildSettingsPatch extraction with tests is still worthwhile.

**Fix plan.** Do it as small, separately verifiable commits, each gated by `pnpm --filter web typecheck` and `next build`.

0. Tooling and characterization tests first. apps/web has no test runner (its package.json has only dev/build/start/typecheck). Add vitest as a devDependency and a `test` script, which `turbo test` then picks up. Write the buildSettingsPatch tests (see testsNeeded) against a temporary copy of lines 562-619 and commit them green before moving any code.

1. Extract the pure save logic into apps/web/src/lib/settings-patch.ts (or alongside the page).
   - Signature: `buildSettingsPatch(settings: GuildSettings, saved: GuildSettings | null, hasDiscordData: boolean): Record<string, unknown>`.
   - Body is lines 562-619 verbatim, with `savedSettings?.` becoming `saved?.`. Keep `saved` nullable so the `?.` behaviour matches.
   - handleSave becomes `const updateFields = buildSettingsPatch(settings, savedSettings, hasDiscordData);`. Everything else stays: setSaving/setMessage, the fetch, and the response handling.
   - Do not "fix" the missing try/finally in this refactor; the finding already marks it as out of scope. Do it as a separate approved change.

2. Move the types. Put GuildSettings, DiscordChannel, DiscordRole and LOG_EVENT_OPTIONS in a shared module, e.g. apps/web/src/app/dashboard/server/[guildId]/types.ts.
   - Optionally derive `GuildSettings` from `GuildRow` (`Omit<GuildRow, "id" | ...>` with a `honeypotAction` narrowing). Do this only as a separate step, after checking `tsc` output field by field.
   - The GET route returns the full row minus `id`, and the page already types it by hand. A derived type must not change the runtime shape. It also needs the client to import only the type from @dragonbot/db (`import type`), so the drizzle runtime does not end up in the client bundle.
   - Keep the hand-written interface if the derivation is awkward. The low-risk part of the finding is the patch builder.

3. Move the primitives verbatim, with no JSX or className edits.
   - Toggle, ChannelSelect, RoleSelect, TagInput, MultiSelect, EventPicker and Section go to components/form/*.tsx.
   - PlaceholderTextarea goes to components/placeholder-editor.tsx. Lift toHTML/fromDOM to module-level pure functions only if they close over no component state. Check this first, because they sit inside the component at lines 142-402.
   - Each file needs `"use client"` only where it uses hooks. Move files one at a time and run a diff on the moved block to prove it is byte-identical apart from `export`.

4. Split the JSX (page lines ~662-921) into one component per Section, each taking `{settings, update, channels, roles}`.
   - State that is local to the honeypot section stays correct only if it is lifted with it. This covers `canEnableHoneypot`, `showHoneypotChannelHint`, `textChannels` and `messagePlaceholders`. Pass them as props or compute them inside the section.
   - `update` must stay the same function. It closes over `settings`, so it is not stable across renders. Do not wrap it in useCallback or React.memo, because that would introduce a stale-closure bug.

5. Final check: `git diff --stat` should show only moves, plus the new settings-patch file and its tests.

**Behaviour to keep the same.** 1. Key inclusion. The PATCH body is validated by guildSettingsUpdateSchema and scope-checked per key. The route's non-wildcard branch derives required scopes from `Object.keys(parsed.data)` via FIELD_SCOPE_MAP. So adding or dropping any key, even one with an unchanged value, changes the 403 behaviour for partial-scope users. For example, sending honeypotChannelId when it is unchanged would 403 a user who lacks that scope. Preserve key presence exactly, not only values.
2. Honeypot semantics. `turnsHoneypotOn = settings.isHoneypotEnabled && !saved?.isHoneypotEnabled`.
   - isHoneypotEnabled is sent only when it differs from saved.
   - honeypotAction is sent when turnsHoneypotOn or it differs from saved.
   - honeypotChannelId is sent only inside the hasDiscordData block, when turnsHoneypotOn or it differs from saved. So with hasDiscordData=false and the honeypot turned on, the channel ID is not sent.
   - `saved` is null-safe: with saved null, the honeypot fields compare against undefined. In practice saved is non-null once settings are loaded.
3. The hasDiscordData gate covers 9 ID fields plus the honeypot channel. It is set only when channels or roles is non-empty, so it can stay false after a successful Discord response with an empty list.
4. The always-sent whitelist is positional by name. A missing key is silently dropped, and an extra key could be rejected by the zod schema. Compare the key sets in a test.
5. `update()` closes over `settings`, so keep it a plain function.
6. isDirty uses JSON.stringify key-order equality, and settings come from GET with the id stripped. Do not restructure how settings are set (for example, normalising fields), or dirty detection changes.
7. PlaceholderTextarea is a contentEditable editor with an `isInternalChange` ref, cursor and mention-popup logic and DOM-based fromDOM. Extracting toHTML/fromDOM can change behaviour if they read refs or state. Verify that by hand, and keep className strings byte-identical.
8. Do not add React.memo or useCallback in this pass. Do not touch the unhandled fetch rejection (the stuck "Saving..." state). The finding explicitly excludes it, and fixing it alters visible behaviour.
9. A `"use client"` boundary and imports from @dragonbot/db must stay type-only on the client.

**Tests.** Existing coverage: none for this page. apps/web has no tests or runner. The apps/bot vitest suites cover honeypot enforcement on the bot side (tests/db/honeypot.test.ts, tests/lib/honeypot-enforcer.test.ts), but nothing exercises the web patch builder, the PATCH route or the validators.

Add before refactoring (vitest in apps/web, pure-function tests, no DOM needed):
1. Always-sent key set. With any settings and hasDiscordData=false and no honeypot change, the keys equal exactly the 27 whitelisted fields at lines 562-591. Assert the full sorted key list as a snapshot, plus a check of each value.
2. Honeypot unchanged (enabled, action and channel equal to saved): the output has no isHoneypotEnabled, honeypotAction or honeypotChannelId keys.
3. Honeypot turned on (saved false, now true), hasDiscordData=true: the output has isHoneypotEnabled, honeypotAction and honeypotChannelId, even if action and channel equal saved.
4. Honeypot turned on with hasDiscordData=false: isHoneypotEnabled and honeypotAction are present, honeypotChannelId is absent.
5. Honeypot turned off: isHoneypotEnabled=false is sent and honeypotAction is not. The channel ID is not sent unless it changed.
6. Only honeypotAction changed (while enabled and already enabled in saved): only honeypotAction is sent.
7. Only honeypotChannelId changed: with hasDiscordData=true it is sent. With hasDiscordData=false it is not.
8. hasDiscordData=true with no honeypot change: exactly the 9 role/channel ID keys are added.
9. hasDiscordData=false: none of the 9 role/channel ID keys are present, and null values in settings do not leak through.
10. saved=null: pin the current behaviour.
11. Each test asserts `Object.keys(...)` equality, not only values, because of the FIELD_SCOPE_MAP scope check. Optionally add a contract test asserting every key the builder can emit is accepted by guildSettingsUpdateSchema (apps/web/src/lib/validators) and has a FIELD_SCOPE_MAP entry where relevant.

Optionally, before the JSX split, add a React Testing Library render of the page, or a manual smoke test in the browser of the PATCH request body in the network tab. Capture the request JSON before and after the refactor for three scenarios (plain edit, honeypot enable, Discord data unavailable) and diff them. For the editor extraction, do a manual check of typing `@` and `#` mentions, placeholder insertion and paste.

### D3
**Permission-scope rules and guild_admins lookup implemented in four forms; the /discord route's shortcut disagrees with the rest**

Impact **medium** (the finder said medium) · Effort **M** · Category duplication

Locations: `apps/bot/src/services/guild-admin.service.ts:32`, `apps/bot/src/repositories/guild-admin.repository.ts:8`, `apps/bot/src/commands/admin.ts:155`, `apps/web/src/lib/discord.ts:129`, `apps/web/src/lib/discord.ts:146`, `apps/web/src/lib/discord.ts:166`, `apps/web/src/lib/discord.ts:173`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:49`, `apps/web/src/app/api/server/[guildId]/route.ts:73`

**What the code does.** The rule ('*' grants everything, otherwise exact scope match, any non-empty grant gives read access) is written in the bot's hasPermission/hasAnyPermission, the bot's admin.ts escalation check, the web's checkGuildPermission and the settings PATCH missing-scope computation (route.ts:73-97, inline and untested). checkGuildPermission and getUserGuildPermissions run the same Discord check and the same guild_admins select. The /discord route adds a third lookup: select by discordId only with .limit(1), then compares r.guildId === guildId; managers of several guilds usually miss and fall through to the full check (a wasted query), and a row with empty permissions passes here although discord.ts:147 and the bot (service:41) deny it. packages/db/src/permissions.ts owns PERMISSION_SCOPES and FIELD_SCOPE_MAP but no helper functions.

**Verifier's notes.** The core claims hold in the code. The bot's GuildAdminService.hasPermission and hasAnyPermission (service.ts:32-42), the admin.ts managers-add escalation check (admin.ts:155-165), the web's checkGuildPermission (discord.ts:129-158) and the inline missing-scope computation in the settings PATCH (route.ts:73-97) each restate the same rules: '*' grants everything, otherwise the scope must match exactly, and an empty list grants nothing. checkGuildPermission and getUserGuildPermissions (discord.ts:166-185) run the same checkDiscordManageGuild call and the same guild_admins select. packages/db/src/permissions.ts holds only constants and maps, with no helper functions. The only related test, apps/bot/tests/db/honeypot.test.ts, asserts FIELD_SCOPE_MAP values and does not test any of the checks.

The /discord route (line 49) does select by discordId only with .limit(1), then tests r.guildId === guildId. A manager of several guilds often gets a different guild's row, misses, and falls through to checkGuildPermission. That fallback first calls checkDiscordManageGuild, which is a Discord API call, and then repeats the guild_admins query. A row with an empty permissions array passes the shortcut, while discord.ts:147 and the bot's hasAnyPermission deny it.

Two caveats. The admin.ts check is a related subset-grant rule rather than an identical copy. The practical exposure is small: the route only returns read-only channel and role lists, and /admin rejects empty grants. Even so, this is fragmented permission logic with a real inconsistency, a wasted Discord API call and query on a dashboard route, and no tests, so medium impact is reasonable.

**Fix plan.** Strictly behavior-preserving refactor, in this order:

1. Add pure helpers to packages/db/src/permissions.ts, which is already exported and shared by the bot and web.
   - `grantsScope(perms: readonly string[], scope?: string): boolean`. It returns false when perms is empty, true when perms includes "*", true when no scope is given, and otherwise `perms.includes(scope)`. This is exactly web `checkGuildPermission` (discord.ts:166-173). For the bot's `hasPermission`, which always has a scope, it is equivalent to `includes("*") || includes(scope)`. The empty-list guard changes nothing there, because an empty list cannot include either value.
   - `missingScopes(required: Iterable<string>, callerPerms: readonly string[]): string[]`. Without a "*" grant it returns the required scopes not in callerPerms (a "*" request is therefore reported as "*"). With a "*" grant it returns []. Preserve the order of the input, since the web error message joins in Set insertion order.
   - `requiredScopesForFields(fields: string[]): string[]`. It maps each field through FIELD_SCOPE_MAP, drops unmapped fields, and dedupes in a Set in first-seen order. Move this out of route.ts:73-97. Callers keep their own message formatting.
   - Do NOT force admin.ts and route.ts onto one message shape. They differ today. The web route lists every missing scope and renders "*" as "full access". admin.ts's "You can only grant permissions you have" shows only "*" when "*" is among the requested permissions, and otherwise lists the non-"*" unauthorized scopes. admin.ts therefore keeps its own formatting, built on a small helper such as `canGrant(callerPerms, requested): { ok: boolean; missing: string[] }`. Or it simply keeps the inline logic, deduplicated between managers-add (155-165) and managers-update (~238-248), which are identical copies. Fixing that copy-paste into one local function is a safe win.
2. Web `apps/web/src/lib/discord.ts`: rewrite `checkGuildPermission` as `grantsScope(await getUserGuildPermissions(guildId, userId), scope)`. This is equivalent in every branch:
   - A Discord manager yields ["*"], so true.
   - A DB error yields [], so false.
   - A missing row yields [], so false.
   - An empty-permissions row yields [], so false.
   - Wildcard, no-scope and exact-match cases are identical.
   - checkDiscordManageGuild is still called once and in the same order.
3. Bot `GuildAdminService.hasPermission` / `hasAnyPermission`: delegate to `grantsScope(admin?.permissions ?? [], scope)`. Keep `getCachedAdmin`, the 24h TTL and the invalidate-on-write logic untouched. `hasAnyPermission` becomes `grantsScope(perms)`.
4. `apps/web/.../[guildId]/route.ts` PATCH: replace the inline block with `missingScopes(requiredScopesForFields(Object.keys(parsed.data)), userPermissions)`. Keep the `userPermissions.length === 0` 403 and the message string as they are.
5. `/discord` route: add `eq(guildAdmins.guildId, guildId)` plus `.limit(1)`, or reuse the same select. Keep the any-row rule, so `isCustomAdmin` is true when a row exists for this guild, including one with empty permissions. This removes the wasted query and the order-dependent result, and it does not need Kevin's approval for the non-empty case. Aligning the empty-permissions case with the bot is a separate behavior change, so leave it behind an approval flag.
6. Optional later step, out of scope here: move the guild_admins select shared by web `checkGuildPermission` and `getUserGuildPermissions` into one local function. This is subsumed by step 2.

Files touched: packages/db/src/permissions.ts, apps/bot/src/services/guild-admin.service.ts, apps/bot/src/commands/admin.ts, apps/web/src/lib/discord.ts, apps/web/src/app/api/server/[guildId]/route.ts, apps/web/src/app/api/server/[guildId]/discord/route.ts, plus new tests.

**Behaviour to keep the same.** - Empty grant list must never grant access, including when no scope is passed (web returns false for empty even in the "no scope" case).
- Requesting scope "*" (honeypot fields, FIELD_SCOPE_MAP `*`) needs a wildcard grant. A caller with ["moderation"] must be refused and shown "full access" in the web message and "*" in the bot message.
- Message-shape differences between admin.ts and the web PATCH. The web version lists all missing scopes in field-iteration (Set insertion) order, maps "*" to "full access", and has no special-casing. The admin.ts version excludes "*" from the unauthorized list but prints only "*" when "*" was requested. A shared helper must not merge these.
- admin.ts bypasses the check entirely for `hasManageGuild` holders, whose bypass comes from interaction member permissions and not from the "*" grant. Keep the bypass outside the helper.
- The bot reads through a 24h TTL cache invalidated on write, while the web reads the DB fresh on every call. Do not unify the data source. In the bot, the cache stores `null` for a non-admin, which is distinct from undefined. Keep that.
- `checkGuildPermission` swallows DB errors and returns false. In the /discord route, an uncaught DB error in the shortcut currently becomes a 500, so keep the shortcut outside the try/catch.
- The /discord shortcut skips the Discord API call (checkDiscordManageGuild) for custom admins. Do not reorder it, or you add latency and a rate-limit risk.
- The /discord route currently picks an arbitrary row when a user has rows in several guilds. After the guildId filter, a same-guild empty-permission row is always accepted, where before it was accepted only by chance of row order. That is the only observable difference. It is a nondeterminism fix, but flag it. Practically no such rows exist, since /admin rejects empty strings, though the DB default is [].
- Do not change permissions case-handling. The bot lowercases input in admin.ts, and the web does not.
- `includes` is case-sensitive and the scope values are plain strings from `text[]`. Keep the helper signatures as `readonly string[]` so both Drizzle's `string[]` and `PermissionScope` callers compile.
- @dragonbot/db is consumed by both apps. Check whether it is built or consumed from source (the exports map) so the new exports resolve in both the bot and web builds.

**Tests.** Existing coverage: none direct. The only permission-adjacent tests are apps/bot/tests/db/honeypot.test.ts and apps/bot/tests/services/honeypot.service.test.ts, which concern honeypot, not scope logic. There is no test of GuildAdminService, admin.ts, web discord.ts, or either route. apps/web has no test files at all.

Add these characterization tests BEFORE refactoring, against the current code:
1. Bot `GuildAdminService` (apps/bot/tests/services/guild-admin.service.test.ts) with a mock repo:
   - hasPermission: no row, empty perms, ["*"], exact scope, other scope, and scope "*" with a non-wildcard grant.
   - hasAnyPermission: no row, [] and non-empty.
   - getPermissions returns [] for a missing row.
   - Caching: the repo is called once for repeated calls, including the null case, and invalidate on addAdmin/removeAdmin forces a re-read.
2. Web, if feasible with a vitest config added to apps/web (or testing via a mocked db and fetch): `checkGuildPermission` and `getUserGuildPermissions` over the full matrix. Cases are manager true/false, row missing, empty row, ["*"], exact scope, no scope with non-empty, scope mismatch, and DB throw. Expected values are pinned from the current code.
3. The PATCH missing-scope block: extract the pure logic first with no change, then pin the exact error string for these cases:
   - Single missing scope.
   - Multiple missing scopes, ordered as the fields were given.
   - The honeypot "*" case, which renders "full access".
   - A wildcard caller, which passes.
   - Unmapped fields, which are ignored.
4. admin.ts escalation: pin the message for a caller with ["moderation"] requesting each of "logging", "*", and "moderation,*", and for a caller with ["*"].
5. After the refactor, add unit tests for grantsScope, missingScopes and requiredScopesForFields, in apps/bot/tests/db/permissions.test.ts or a new vitest setup in packages/db. These must pass unchanged against the pre-refactor characterization expectations. Run the full bot test suite plus `pnpm turbo typecheck` and the web build.
6. For the /discord route, a small route-level test with a mocked db showing a row in another guild only falls through to checkGuildPermission. Pin the any-row behavior for a same-guild empty-permissions row as the intended current behavior.

### P1
**/api/guilds makes up to ~60-80 sequential Discord calls per dashboard load, fetching each guild and member twice**

Impact **medium** (the finder said high) · Effort **M** · Category performance

Locations: `apps/web/src/app/api/guilds/route.ts:49`, `apps/web/src/app/api/guilds/route.ts:54`, `apps/web/src/app/api/guilds/route.ts:60`, `apps/web/src/app/api/guilds/route.ts:69`, `apps/web/src/app/api/guilds/route.ts:71`, `apps/web/src/lib/discord.ts:54`, `apps/web/src/lib/discord.ts:78`, `apps/web/src/lib/discord.ts:85`, `apps/web/src/lib/discord.ts:91`, `apps/web/src/lib/discord.ts:140`, `apps/web/src/lib/discord.ts:242`, `apps/web/src/app/dashboard/layout.tsx:44`

**What the code does.** Runs on every dashboard layout mount. A sequential for...await loop covers up to MAX_DISCORD_CHECKS=20 guilds. For each, checkGuildPermission -> checkDiscordManageGuild fetches GET /guilds/{id} and GET /guilds/{id}/members/{user}, then runs a guild_admins query that cannot help (custom-admin guilds were already filtered at route.ts:40-45). For non-admins isGuildMember refetches the same member; afterwards getGuildIconUrl refetches GET /guilds/{id} for every accessible guild. Worst case ~20 x (2-3 Discord calls + 1 DB query) plus N icon fetches, several seconds before the sidebar renders, and it burns the bot token's rate limits shared with the running bot. No tests.

**Verifier's notes.** The core claim holds. In route.ts:49-66 a sequential for...await loop covers up to MAX_DISCORD_CHECKS=20 guilds. checkGuildPermission calls checkDiscordManageGuild, which makes GET /guilds/{id} and then GET /guilds/{id}/members/{user} (except for the owner). It then runs a guild_admins query, and that query is redundant because custom-admin guilds were already skipped at lines 40-45. For non-admins, isGuildMember (discord.ts:242) fetches the same member endpoint again. Then getGuildIconUrl fetches GET /guilds/{id} again for every accessible guild. So each guild and member really is fetched twice. There is no cache and no tests for apps/web.

Some overstatements:
(1) The icon fetches run in parallel with Promise.all (line 69), not sequentially. So the worst case is about 60 sequential calls (20 x 3) plus up to 20 icon calls in parallel, not "60-80 sequential".
(2) dashboard/layout.tsx is a client layout. It fetches once on mount, and App Router layouts persist across dashboard navigations, so this runs once per dashboard entry or reload, not once per page.
(3) The cost grows with how many guilds the bot is in. For a bot in a handful of servers the delay is small.

The redundant calls are real and the fix is sound, but the cost depends on guild count and is paid once per session. Medium impact fits better than high.

**Fix plan.** Verified against the code. In route.ts the per-guild loop (lines 49-66) calls checkGuildPermission, which calls checkDiscordManageGuild (GET /guilds/{id}, then GET /members/{user} unless the user is owner), then a guild_admins query. That query cannot match for these guilds, because every guild where the user has a guild_admins row was already taken at lines 40-45. A non-admin then triggers isGuildMember (a second GET of the same member). After the loop, getGuildIconUrl does another GET /guilds/{id} for every accessible guild. A non-admin member costs 3 Discord calls plus 1 DB query, then 1 icon call. An admin costs 2 calls plus 1 DB query only if the check fails, plus 1 icon call. Worst case is about 20x3 = 60 checks plus up to 20 icon calls (those run in parallel), roughly 60-80 calls in total. No behavior-preserving obstacle was found. Steps:

1. In apps/web/src/lib/discord.ts, add an exported `fetchGuildAndMember(guildId, userId)` returning `{ guild: DiscordGuild | null; member: DiscordGuildMember | null; memberOk: boolean }`.
   - Fetch the guild first. Use `res.ok` plus a try/catch around `.json()`, so any failure gives `guild = null`.
   - If `guild?.owner_id === userId`, skip the member fetch and set `memberOk = true` (the owner counts as a member, which matches old behavior where isAdmin:true was returned without any member call).
   - Otherwise fetch the member even when the guild fetch failed or its JSON was malformed. Set `memberOk = res.ok`, and parse the member JSON separately inside its own try/catch. This matches isGuildMember, which only looks at `res.ok`.
   - A thrown fetch error must give `memberOk = false`, as isGuildMember's catch does.
   - Keep the guild fetch before the member fetch (sequential), so the owner short-circuit still saves a call.
2. Extract a pure helper `hasManageGuildFrom(guild, member, guildId)`. It holds the existing logic: @everyone role id equals guildId, OR each role's permissions, Administrator returns true, a timed-out member returns false, then the Manage Server bit. Return false if guild or member is null, or if BigInt/JSON handling throws. Make checkDiscordManageGuild call the helper after its own sequential fetches, so the single-guild routes (checkGuildPermission, getUserGuildPermissions) keep identical behavior and there is one copy of the permission logic. Do not change the signatures of checkGuildPermission, isGuildMember or getUserGuildPermissions. The leaderboard route and about 10 server routes use them.
3. Add a pure `iconUrlFromGuild(guildId, guild)`. It returns null when the icon is null or the guild is null. Otherwise it returns `https://cdn.discordapp.com/icons/${guildId}/${icon}.${icon.startsWith("a_") ? "gif" : "png"}?size=128`. Make getGuildIconUrl reuse it, so the formula lives in one place. Keep getGuildIconUrl for the custom-admin guilds.
4. Add an exported helper in discord.ts, for example `resolveGuildAccess(guildId, userId)`, returning `{ access: "admin" | "member" | "none"; iconUrl }`. It is built from fetchGuildAndMember: owner or hasManageGuildFrom gives admin; else memberOk gives member; else none. For admin or member, iconUrl comes from the fetched guild.
5. Rewrite the route loop.
   - Compute `toCheck = allGuilds.filter(not custom admin).slice(0, MAX_DISCORD_CHECKS)`. This selects the same 20 as the current counter, because every non-custom guild consumes one check regardless of outcome.
   - Resolve them through an order-preserving map. First ship it sequential (zero rate-limit risk). Optionally add a bounded pool of 3-5 that writes into `results[i]`.
   - Then build `accessible` as [custom-admin guilds in allGuilds order, with isAdmin:true] followed by [checked guilds in allGuilds order, admin or member].
   - Custom-admin guilds still need one icon fetch each via getGuildIconUrl. Run those in Promise.all, alongside the checks, or in the final stage.
   - Drop the guild_admins DB query for checked guilds.
   - Final JSON must be identical: `{guildId, guildName, iconUrl, isAdmin}` per row in the same order.
6. Optional per-request memoization only. Do not add cross-request caching.

Estimated call reduction for the common non-admin case is 3 to 2 calls per checked guild plus 0 icon calls, and DB queries drop from N to 0. With a pool of 5, wall time drops roughly 5x. Files touched: apps/web/src/lib/discord.ts, apps/web/src/app/api/guilds/route.ts, and a new test file with a test runner config.

**Behaviour to keep the same.** 1. Order: custom-admin guilds come first, then checked guilds, each in allGuilds order. A pool must collect results by index, not by completion order.
2. Cap: the 20 checks apply to non-custom guilds only, counted whether or not access is granted. Custom-admin guilds are never Discord-checked, are listed with isAdmin:true even if the user is not in the guild, and have no cap.
3. Owner: no member fetch, counts as admin and member. If the guild fetch fails, the owner is not recognised, so fall through to the member fetch.
4. Fail-closed: a failed or non-ok guild fetch, bad JSON, or a BigInt throw means not admin. Membership must still be decided separately by member `res.ok`. A member whose guild fetch failed, or whose member JSON is malformed, is still listed as isAdmin:false (old behavior via isGuildMember). Do not merge memberOk with JSON parse success.
5. Timed-out members keep only Administrator (not Manage Server), but remain members. A role id the guild does not list is skipped. @everyone permissions apply.
6. Icon: the old code did a separate fetch, so a guild fetch that succeeded earlier cannot now fail for the icon, and vice versa. A transient failure on the first call would previously give admin false but could still list the guild as a member with a working icon. Under the new code the icon is null for that guild. This is a tiny edge difference. It is acceptable, but document it. For custom-admin guilds the icon fetch is unchanged. Format: gif when the hash starts with a_, otherwise png, with size=128, built from the path guildId.
7. DB behavior: dropping the guild_admins query removes a DB-error path that returned false. The query was already unable to match, so output is the same barring a concurrent row insert mid-request.
8. Parallelism: the bot token is shared and the web fetches have no 429 retry. A burst can return 429, which fails closed and makes a guild vanish from the list nondeterministically. Keep the pool at 3-5 or ship sequential first. Cross-request caching would delay permission revocation and must not be added.
9. Do not change checkGuildPermission, getUserGuildPermissions or isGuildMember semantics. Other routes depend on them, including the leaderboard membership gate and the 403 paths. Unhandled-error behavior: all helpers must keep catching everything and never throw into the route.

**Tests.** Existing coverage: none for this code path. There is no test file, test script or runner under apps/web (git ls-files finds no test/spec files there, and package.json has no test script). The bot tests under apps/bot/tests (vitest) do not touch apps/web/src/lib/discord.ts or /api/guilds.

Before refactoring, add a test runner to apps/web (vitest, matching the bot's tooling) and write characterization tests against the CURRENT code, so they pass before the change and after.

- Mock global fetch (route by URL), `@/lib/env`, `@/lib/db` (a chainable select/from/where/limit mock returning guild_admins rows) and `@/lib/auth` getAuthenticatedUser.
- Route-level tests for GET /api/guilds, covering these cases:
  1. 401 when unauthenticated.
  2. Owner: listed isAdmin:true, with a gif/png icon.
  3. Administrator via role permission: isAdmin:true.
  4. Manage Server only: isAdmin:true.
  5. Timed-out Manage Server holder (communication_disabled_until in the future): isAdmin:false but listed as a member.
  6. Timed-out Administrator: still isAdmin:true.
  7. Plain member: isAdmin:false.
  8. Non-member (member fetch returns 404): not listed.
  9. Guild fetch fails (500) or returns bad JSON, but member OK: listed isAdmin:false with iconUrl null.
  10. Member JSON malformed but status ok: listed isAdmin:false.
  11. Custom-admin guild: listed isAdmin:true with no Discord check, and the icon is fetched from /guilds/{id}. Include a custom admin who is not in the guild.
  12. Icon variants: a_ hash gives gif, a plain hash gives png, icon null gives null, always with `?size=128`.
  13. 25 non-custom guilds: only the first 20 are checked, and guilds 21+ get no member or guild fetch.
  14. Output ordering: custom-admin first, then checked guilds in allGuilds order, with mixed members and admins.
  15. fetch throwing.
- Unit tests for checkGuildPermission, getUserGuildPermissions and isGuildMember, including the guild_admins scope, wildcard and empty-permissions cases. This protects the shared helper reused by step 2.
- If a pool is added, a test with fetch mocked to resolve out of order, asserting the output order is unchanged.
- Snapshot the full JSON output for a fixed fixture, run it on the old implementation, and assert byte-for-byte equality after the refactor.
- Optionally assert fetch call counts after the refactor (they should drop) as a new, non-characterization test.

### P10
**Startup runs every step serially; webhook server and sync timer start only after birthday and YouTube checks, and XP earned before hydrate is overwritten**

Impact **medium** (the finder said medium) · Effort **M** · Category performance

Locations: `apps/bot/src/index.ts:130`, `apps/bot/src/index.ts:147`, `apps/bot/src/index.ts:154`, `apps/bot/src/index.ts:164`, `apps/bot/src/lib/youtube-checker.ts:57`, `apps/bot/src/services/youtube.service.ts:27`, `apps/bot/src/services/xp.service.ts:65`, `apps/bot/src/services/xp.service.ts:82`

**What the code does.** clientReady awaits hydrateAll, xp.hydrate, scheduler.loadAll, birthdayChecker.check (Discord REST per guild), youtubeChecker.check (one feed fetch per subscription, sequential, up to 10s each), and only then starts the webhook server (164) and the 4-hour timer (179). Dashboard reload pings in that window are refused, so settings stay stale until the next 4-hour hydrateAll. processMessage doesn't check isHydrated and hydrate overwrites with xpMap.set (65), so XP earned before hydration is lost and a false level-up can post. The two hydrates are independent but sequential.

**Verifier's notes.** I confirmed the core claims in the code. In apps/bot/src/index.ts, the clientReady handler awaits five steps one after another: guildService.hydrateAll, xpService.hydrate, scheduler.loadAll, birthdayChecker.check and youtubeChecker.check. Only after those does it create HoneypotWarningSync, call startWebhookServer and arm the 4-hour setInterval. YouTubeChecker.runCheck loops over subscriptions with `await fetchRecentVideos` one at a time, and each fetch has `AbortSignal.timeout(10_000)`. The final comment ("Last, so a slow sync can't hold back the webhook server or the timer") shows the author meant to keep slow work after the server starts, yet the birthday and YouTube checks still run before it. Until the server starts, nothing is listening, so a dashboard reload ping in that window fails. Because hydrateAll has already run, those settings stay stale until the next 4-hour sync or an /admin reload. The XP problem is also real. discord.js replays queued gateway events right after it emits ready, while the async handler is still awaiting. message-create.ts calls xp.processMessage without checking isHydrated (that flag is only read by getStats), and getSettings falls back to the database when its cache is empty, so XP is processed during the window. processMessage creates a zeroed entry, which can produce a false level-up, and hydrate() then replaces it with xpMap.set, losing the delta. The two hydrates do not depend on each other. Impact is limited: all of this happens only at startup and the window usually lasts seconds; it grows to tens of seconds only with many subscriptions or slow feeds. The XP loss is small and rare. I keep it at medium mainly because of the correctness bug and the stale-settings window, not raw performance.

**Fix plan.** Split P10 into two changes and ask for approval on each. The user's no-functional-change rule applies only to part A.

PART A (behavior-preserving, about S, but M once the tests are written). Everything is in apps/bot/src/index.ts, inside the clientReady handler.
1. Replace the two sequential awaits at lines 134 and 138 with `const [guildCount] = await Promise.all([guildService.hydrateAll(), xpService.hydrate()])`. Keep the "Guild settings hydrated" log. The two hydrates read different tables and share no state. Keep rejection behaviour the same: a failure of either still rejects the handler.
2. Keep `scheduler.loadAll()` and `ctx.scheduler = scheduler` right after the hydrates. Do not move the webhook server before loadAll. A webhook-triggered `scheduler.reload()` racing `loadAll()` could double-register cron jobs.
3. Construct BirthdayChecker, YouTubeChecker and HoneypotWarningSync, and set ctx.honeypotWarning, with no awaited work yet. Then start the webhook server, arm the 4-hour timer and call unref(). The timer closure references the checker consts, so construct them before the timer.
4. After that, run `await birthdayChecker.check()` and `await youtubeChecker.check()` inside try/catch. Today a throw from either aborts the rest of the handler, including the webhook, timer and honeypot sync. The proposed fix would let the bot survive a throw and log it. That is a robustness change, so either keep the throw semantics deliberately or call it out. Keep the `ctx.birthdayChecker` and `ctx.youtubeChecker` assignments and the "initialized" logs. Nothing reads those two ctx fields outside index.ts, so there is no race.
5. Keep the final `honeypotWarning.syncAll()` last, with its try/catch, and keep the comments about ordering at lines 190 and 200.

Optional: extract the handler body into an exported `runStartup(deps)` function so it can be unit-tested. This is a pure move.

PART B (behavior change, not covered by the no-change rule, needs explicit approval). Fix the XP overwrite in xp.service.ts hydrate (line 65) and processMessage (line 82). Clients start receiving messageCreate before clientReady finishes hydrating. Preferred option: in hydrate, if a key already exists in xpMap, merge instead of `set`. Take the DB row as the base and add the in-memory totalXp, messageCount and xpMessageCount deltas. Set lastMessageAt to the max of the two, recompute level with levelFromXp, and set dirty=true. Alternative: have processMessage return null until isHydrated. That drops message counts during the window and still skips the cooldown gate. A false level-up message already posted cannot be undone by the merge. Only the skip option prevents it.

Out of scope for P10 but noticed: `startFlushTimer` is defined at xp.service.ts:241 and never called. XP is flushed only by the 4-hour timer and at shutdown, so a crash loses up to 4 hours of XP. Flag it as a separate finding.

**Behaviour to keep the same.** 1. Webhook before startup checks. The reload handler uses getScheduler(), which is already safe when undefined. onGuildReload uses honeypotWarning, which is constructed before the server starts, so it is not undefined. commands/admin.ts reload uses `ctx.scheduler` if set and `ctx.honeypotWarning?.`. It never touches birthdayChecker or youtubeChecker, so the webhook-ordering concern in the finding is a non-issue. grep shows those two ctx fields are only declared in types/context.ts and assigned in index.ts.
2. Cache invalidation vs birthday check (real). A webhook reload for one guild calls invalidateCache then getSettings, which briefly removes that guild from the cache. BirthdayChecker.check() reads getAllCached() and would silently skip that guild until the next 4-hour run. Today the webhook cannot run during the startup check, so this is a new window. It is small. The comment at index.ts:190 is about the same hazard in the periodic path. Options are to accept it, or to run the birthday check before the webhook starts and only the slow YouTube check after.
3. A webhook-triggered scheduler.reload() during the startup YouTube check is harmless. It does not touch the checkers.
4. Concurrent hydrateAll. A webhook full reload overlapping startup hydrate is guarded by guildService.writtenSince/writeCount. Settings reads fall back to the DB when the cache is empty, so a pre-hydrate message still works.
5. Timer anchor. The 4-hour interval would start earlier by the length of the birthday and YouTube checks, which can be minutes. This is harmless, but it is a visible difference.
6. Error semantics, as described in plan step 4. A throw from a startup checker today skips the webhook, timer and honeypot sync. Wrapping in try/catch changes that. It is arguably a fix, but flag it. youtubeChecker.check() already catches per subscription, so a throw is unlikely. birthdayChecker.check() has no running guard. The first timer fire is 4 hours out, so overlap is not realistic.
7. Log order changes: the "Birthday checker initialized" and "YouTube checker initialized" lines would now come after the webhook "listening" line.
8. XP merge (Part B) changes totals during the startup window by design. With no skip, a level-up message can still fire at hydrate time. If processMessage skips XP until hydrated, message counts also change.
9. Unhandled rejection: with Promise.all, if xpService.hydrate fails while hydrateAll is in flight, the handler rejects the same way, but the other promise still runs to completion.

**Tests.** Existing coverage: no tests for index.ts, xp.service.ts or webhook-server.ts. Relevant tests that do exist are in apps/bot/tests/lib/scheduler.test.ts, birthday-checker.test.ts, youtube-checker.test.ts, honeypot-warning.test.ts and tests/services/guild.service.test.ts. They cover the pieces but not startup ordering.

Add before refactoring:
1. A startup-order characterization test. First extract `runStartup(deps)` as a pure move, or run the clientReady handler with mocked services and a fake client. Record the call order, hydrates then loadAll then birthday check then YouTube check then honeypot construction then webhook start then timer then syncAll. Then update the expectation for the intended new order. Assert that the webhook is not started when BOT_WEBHOOK_SECRET is unset.
2. A webhook-server test using a real http server on an ephemeral port. Cover GET /health, 401 on a bad bearer, 400 on a bad snowflake, and a reload with getScheduler returning undefined (200). Also cover onGuildReload being called without being awaited.
3. XP service tests (tests/services/xp.service.test.ts) for hydrate, processMessage cooldown and level-up, and flush dirty handling. Add a test for the current overwrite (processMessage before hydrate, then hydrate) as a characterization test. For Part B, add merge-semantics tests: totals are summed, lastMessageAt takes the max, the level is recomputed and the entry is dirty.
4. A timer test with fake timers. After startup, advancing 4 hours triggers flush, hydrateAll, reload, the birthday check, the YouTube check and then honeypot syncAll, with the honeypot sync still running if an earlier step throws.
5. A test that a webhook reload racing the birthday check does not drop a guild, if the user wants risk 2 closed.

### P3
**Leaderboard routes resolve up to 100 Discord users per request in fixed waves with a per-instance cache, on a public unauthenticated route**

Impact **medium** (the finder said high) · Effort **M** · Category performance

Locations: `apps/web/src/lib/discord.ts:186`, `apps/web/src/app/api/leaderboard/[guildId]/route.ts:28`, `apps/web/src/app/api/server/[guildId]/leaderboard/route.ts:30`, `apps/web/src/middleware.ts:48`

**What the code does.** Each request selects 100 user_xp rows and calls resolveDiscordUsers, which fetches GET /users/{id} in fixed batches of 5 (queue.splice + Promise.all), so each batch waits on its slowest call: 20 sequential batches cold. userCache is a module-level Map: per serverless instance, lost on cold start, never pruned. /api/leaderboard/[guildId] needs no auth, so any visitor can trigger up to 100 bot-token calls per request; only a per-IP, per-instance in-memory limiter stands in the way. 429s are not cached and fall back to raw IDs, so the page silently degrades under load. No tests.

**Verifier's notes.** The code matches the finding. resolveDiscordUsers (apps/web/src/lib/discord.ts:220-237) uses queue.splice(0, 5) plus Promise.all, so up to 20 batches run one after another and each waits on its slowest call. userCache (line 187) is a module-level Map with a 10-minute TTL that is never pruned. A 429 returns null without being cached, and a thrown error is also not cached. Both leaderboard routes select 100 user_xp rows and enrich them the same way. /api/leaderboard/[guildId] has no auth check (it only validates the snowflake and that the guild exists) and is fetched by the public page src/app/leaderboard/[guildId]/page.tsx. The only throttle is the per-IP, per-instance in-memory limiter of 60 requests a minute in middleware.ts / lib/rate-limit.ts. No leaderboard tests exist. Two things argue against "high". First, the warm-instance cache absorbs repeat views of the same guild for 10 minutes, so the cost is mainly cold or first loads. Second, only guilds that exist in the DB can be targeted, and rows are capped at 100. What is left: cold loads are slow because the batches run back to back, and the page silently falls back to raw IDs on 429s. There is also a moderate abuse surface: if DISCORD_API_TOKEN is the bot's own token, the bot shares Discord's global rate limit with the web app. That is a real issue but not top severity, so medium fits better.

**Fix plan.** Verified: resolveDiscordUsers/resolveDiscordUser are used ONLY by the two leaderboard routes (apps/web/src/app/api/leaderboard/[guildId]/route.ts and apps/web/src/app/api/server/[guildId]/leaderboard/route.ts), so blast radius is small. Split into two independent, separately shippable steps.

Step 1 (S, pure, zero-risk, do first): in apps/web/src/lib/discord.ts replace the splice+Promise.all batch loop in resolveDiscordUsers with a sliding worker pool of width `concurrency` (default 5): spawn min(concurrency, n) workers that share an index counter, each loops `while (i < ids.length) { const id = ids[i++]; const data = await resolveDiscordUser(id); if (data) results.set(id, data); }`, then `await Promise.all(workers)`. Same max in-flight (5), same Map output (keys are the same; only insertion order may differ, and no caller iterates the map, they only .get()). Also de-duplicate IDs with new Set(userIds) is optional and safe (user_xp has a unique (guild,user) key so entries are already distinct). Cold wall time drops from sum-of-batch-maxima to roughly total/5.

Step 2 (M, optional, needs a deployment decision): make the cache cross-instance while preserving semantics. Keep resolveDiscordUser's contract (returns data or null) but separate the fetch into an inner function `fetchDiscordUser(id)` that returns {kind:'ok',data} | {kind:'notok'} (non-OK, non-429 -> cached as null) and THROWS on 429 and on network/JSON errors so the cache layer does not store them. Wrap with Next 16 `unstable_cache(fetchFn, ['discord-user', id], {revalidate: 600})` per id (or 'use cache' + cacheLife with revalidate/expire 600s; this requires cacheComponents enabled in next.config, currently not set, which is a config change with wider effect on the app, so prefer unstable_cache or an external KV such as Upstash/Vercel KV with SETEX 600). The outer resolveDiscordUser catches the throw and returns null (current behavior for 429/errors). Keep an in-process Map as an L1 in front (cheap, same 10 min TTL) to avoid cache-store round trips. Additionally consider a bulk-read (KV mget) to avoid 100 cache round-trips. Optionally, to address the public-route abuse, also cache the whole assembled leaderboard payload for /api/leaderboard/[guildId] for a short TTL (30-60s) via unstable_cache keyed by guildId, but that changes staleness of XP numbers, which is a visible behavior change: only do it with the user's explicit approval; otherwise leave out.

Step 3 (depends on D6): extract shared `getLeaderboardEntries(guildId)` (select 100 rows by totalXp desc + resolve + map to displayName/avatarUrl fallback) used by both routes; each route keeps its own auth/404 logic and its own response envelope ({guildName, entries} vs bare array) and error body shapes (public route: {error:'Guild not found'} with no code; authed route: {error, code}).

Files: apps/web/src/lib/discord.ts, new apps/web/src/lib/leaderboard.ts (step 3), the two route files, possibly next.config / env for KV.

**Behaviour to keep the same.** 1) 429 and thrown errors must never be stored in a shared cache (unstable_cache caches any returned value, including null, so the 429 must be signalled by throwing and caught outside the cache; note unstable_cache with a thrown error does not cache). Otherwise a rate-limit burst would pin raw IDs for 10 min across all instances. 2) Non-OK non-429 (e.g. 404 deleted user) must still cache as null for 10 min, and a cached null must still yield displayName=discordId and avatarUrl=null; distinguish 'cached null' from 'cache miss' (do not use falsy checks). 3) Avatar URL format must stay `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` (uses user.id from the response, .png always even for animated hashes, size=64); displayName = global_name ?? username (?? not ||, so empty-string global_name stays empty). 4) Response shapes differ: public route returns {guildName, entries[]} with 404 {error:'Guild not found'}; member route returns bare array with 401/403/404 including `code`. Entry objects spread discordId,totalXp,level,messageCount,xpMessageCount then displayName, avatarUrl; keep key set/order and that username is NOT returned. 5) Keep limit 100 and orderBy desc(totalXp) (no tiebreaker today; adding one would change ordering of ties, so don't). 6) Concurrency cap must stay <=5 in-flight; a sliding pool does not increase it, but also don't raise default. 7) Sliding pool changes Map insertion order and timing only. 8) Dedup of IDs must not change output. 9) Cache TTL semantics: unstable_cache revalidate is stale-while-revalidate, not a hard expiry: a stale value may be served once after 10 min, a small difference; KV SETEX gives exact TTL. 10) Per-route rate limiting in middleware (60/min/IP, in-memory per instance) is a separate concern: moving it to a shared store (e.g. Upstash ratelimit) is a behavior change for error responses under load and should be treated as a separate finding/approval. 11) Serverless: module-level Map still works as L1 but is never pruned; adding pruning must not evict live entries early. 12) Do not cache the whole response if XP freshness must be preserved.

**Tests.** Existing coverage: none for apps/web (no test files or vitest config under apps/web; only apps/bot has tests). Before refactoring, add a test runner to apps/web if absent (vitest, node env) and write characterization tests against the CURRENT resolveDiscordUser/resolveDiscordUsers with a mocked global fetch and fake timers, mocking '@/lib/env' (DISCORD_API_TOKEN) and '@/lib/db' (discord.ts imports db): (a) 200 response -> {username, displayName: global_name, avatarUrl with .png?size=64}; global_name null -> username; avatar null -> avatarUrl null. (b) Authorization header is `Bot <token>` and URL is /api/v10/users/{id}. (c) second call within 10 min makes no fetch (cache hit); after advancing 10 min+1ms it refetches. (d) 404/403 -> null and cached (no second fetch within TTL). (e) 429 -> null and NOT cached (second call refetches). (f) fetch throws / res.json throws -> null, not cached. (g) resolveDiscordUsers: omits failed ids from the Map, returns entries for successes, never exceeds 5 concurrent in-flight fetches (track in-flight counter with deferred promises), handles empty array, and with 12 ids makes exactly 12 fetches. Use vi.resetModules() between tests to clear the module-level cache. Route-level tests for both routes with mocked db and resolveDiscordUsers: public route 404 for bad snowflake and missing guild, response shape {guildName, entries}; entries get displayName fallback to discordId and avatarUrl null when unresolved; member route 401/403/404 with codes and bare-array shape; .limit(100) and orderBy desc(totalXp) called. Add a new concurrency test after step 1 asserting sliding behavior (a slow call in a group does not block starting the next id) and a cache-layer test for step 2 asserting 429/throw is not persisted while 404-null is. Run these tests against the old code first (they must pass), then against the refactor unchanged.

### C5
**AGENT.md layering rules contradict the code (repositories used from commands/lib, discord.js in services)**

Impact **low** (the finder said medium) · Effort **S** · Category complexity

Locations: `apps/bot/src/commands/xp-admin.ts:180`, `apps/bot/src/lib/youtube-checker.ts:23`, `apps/bot/src/lib/youtube-checker.ts:72`, `apps/bot/src/services/logging.service.ts:1`, `apps/bot/src/services/moderation.service.ts:1`, `apps/bot/src/types/context.ts:26`, `apps/bot/src/index.ts:94`

**What the code does.** AGENT.md says commands and events never use repositories and services never import discord.js. In code: xp-admin uses ctx.xpArchiveRepo, YouTubeChecker writes through YouTubeRepository (YouTubeService only fetches RSS), and LoggingService and ModerationService import discord.js and take a Client. BotContext.db is exposed but unused (X5). Contributors following the doc find the opposite in the code.

**Verifier's notes.** Confirmed. AGENT.md:63-64 says commands and event handlers never import from repositories/, and services never import discord.js. In the code, apps/bot/src/services/logging.service.ts:1 and moderation.service.ts:1 import from discord.js (EmbedBuilder, DiscordAPIError, Client), and both take a Client. That breaks the second rule outright. xp-admin.ts:180 calls ctx.xpArchiveRepo.create(...) directly. No file under commands/ or events/ imports repositories/, so it keeps the letter of the rule but not its spirit. AGENT.md:94 even documents xpArchiveRepo on the context. YouTubeChecker in lib/ takes a YouTubeRepository and calls updateLastVideoId (lines 23 and 72). BotContext.db is set at index.ts:94, and a grep found no ctx.db reads in the bot. One nuance: the 'commands never import repositories' wording is technically met because the access goes through ctx. Even so, the documented layering does not match the code. Impact: this is doc drift with no runtime effect, so it is low on its own. It matters more because the user asked for the architecture doc remap, which is where the fix belongs.

**Fix plan.** Documentation-only fix, recommended over moving code (moving code would add risk for no functional gain). Edit AGENT.md "Layered Design" section (about lines 50-65, plus line 94 and the line 168 note) and touch no source files.

1. Rewrite the rules at lines 63-64 to describe the real layering:
   - Commands and event handlers should normally go through services. Known exceptions: xp-admin.ts uses ctx.xpArchiveRepo (line 180). If C2 removes that case, drop the exception.
   - lib/ holds Discord-facing orchestrators and schedulers (YouTubeChecker, BirthdayChecker, honeypot enforcer and warning sync). They take a Client and may call repositories directly. For example, YouTubeChecker writes through YouTubeRepository (lines 23, 47, 72), while YouTubeService only fetches RSS.
   - LoggingService and ModerationService are Discord adapters. They import discord.js and take a Client. Every other service stays discord.js-free and works on plain data. Verify the full list with `grep -ln "from \"discord.js\"" apps/bot/src/services`, and also check guild-admin and honeypot. Do not claim "only two" unless the grep confirms it.
2. Document that BotContext.db (types/context.ts:26, index.ts:94) is exposed but currently unused, and that xpArchiveRepo is optional on BotContext. Link this to X5.
3. Optionally add a short "where code actually lives" table: commands/, events/, services/, repositories/, lib/, utils/.
4. Before editing, rerun the verification greps so the doc states only what the code does:
   - `grep -rn "repositories/" apps/bot/src/commands apps/bot/src/events apps/bot/src/lib`
   - `grep -rln "discord.js" apps/bot/src/services`
   - `grep -rn "ctx.db" apps/bot/src`
   Note the initial run of the last grep produced no usable output because of a shell glob error, so it must be repeated. Type-only imports of repositories in context.ts and lib/ also count as repository use and should be described accurately.
Effort S: one file, under 1 hour.

**Behaviour to keep the same.** Essentially none, because the change is documentation only and no runtime code changes. Two risks apply. (a) Accuracy: the doc must match the code at the commit it is written against. Other audit findings (C2 removing the xp-admin repo use, X5 removing BotContext.db) may later make parts of the new text stale, so write the rules so they survive those changes, or update them in the same pass. (b) If the alternative is chosen and code is moved to match the old rules (for example extracting a YouTube persistence service, or splitting discord.js out of Logging and Moderation), watch for several things. Import paths change. Constructor signatures and wiring in index.ts change. Test mocks in apps/bot/tests (youtube-checker, logging.service, moderation.service) change. Ordering of DB writes versus Discord calls could change, which matters because YouTubeChecker updates lastVideoId right after posting. Error handling and logging, including pino fields, must not change. Moving code is not recommended for this finding.

**Tests.** No tests are needed for the doc fix. Existing tests cover the relevant classes: apps/bot/tests/lib/youtube-checker.test.ts, apps/bot/tests/services/logging.service.test.ts and apps/bot/tests/services/moderation.service.test.ts. There is no test file for xp-admin or XpArchiveRepository in the listing I saw (the listing was cut at 30 entries, so confirm). If the code-move alternative were pursued, first add characterization tests for: (1) YouTubeChecker's order of operations (post to channel, then updateLastVideoId) and its behavior when the post fails; (2) xp-admin archive flow behavior when xpArchiveRepo is undefined (it replies "Archive system not available." and breaks); (3) the current constructor and wiring contract. An optional guard against doc drift is a lint or test script that fails if commands/ or events/ import from repositories/, with the known exceptions allowlisted.

### D10
**NeonActivityLogger class copied verbatim in both DB clients**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `packages/db/src/client.ts:8`, `packages/db/src/serverless.ts:6`

**What the code does.** The two 14-line Drizzle logger classes are byte-identical (same JSON log shape, 200-char truncation, source 'neon'); any change to the log format (e.g. redaction) must be made twice.

**Verifier's notes.** I could not refute this. The NeonActivityLogger class in packages/db/src/client.ts (lines 8-21) and in packages/db/src/serverless.ts (lines 6-19) is character-for-character identical: the same JSON shape, the same `source: "neon"`, and the same 200-character truncation with an ellipsis. The two separate files are intentional. package.json exports "./serverless" on its own, so the Next.js app does not pull in postgres-js. That makes the proposed fix sound: a third file, logger.ts, that imports only the type. The impact is low. The duplicate is 14 lines, it does not change behavior, and the main cost is that a change to the log format has to be made twice.

**Fix plan.** Verified: packages/db/src/client.ts:8-21 and packages/db/src/serverless.ts:6-19 hold identical NeonActivityLogger classes. Each is used only inside its own factory (createBotClient / createServerlessClient). The name, the JSON log string and the logger are not referenced anywhere else in the repo.

Steps:
1. Create packages/db/src/logger.ts. It contains `import type { Logger as DrizzleLogger } from "drizzle-orm/logger";` plus the class, copied byte for byte and exported as `export class NeonActivityLogger implements DrizzleLogger { ... }`. Keep the 200-char slice, the "…" character (U+2026), the field order (level, msg, source, timestamp, command, query) and the `console.log(JSON.stringify(...))` call.
2. In client.ts and serverless.ts, delete the local class and the `DrizzleLogger` type import. Add `import { NeonActivityLogger } from "./logger";`. Leave the `new NeonActivityLogger()` call sites unchanged.
3. Do not touch index.ts or the package.json exports map. Do not re-export the class from index.ts. Do not put it in client.ts.
4. Run `pnpm --filter @dragonbot/db typecheck`, then typecheck and build apps/bot and apps/web. Run the bot vitest suite. Optionally run `next build` and grep the web server output for "postgres" to confirm the web bundle is unchanged.

Why the web bundle is safe: apps/web/src/lib/db.ts imports "@dragonbot/db/serverless", and the package exports map has a ./serverless subpath. That path never loads index.ts or client.ts. The bot imports createBotClient from the "@dragonbot/db" root. logger.ts imports only a type, so it adds no runtime dependency to either side.

Note on the finding's "do not re-export from index": that stays valid. The web app already avoids index.ts through the subpath, so index.ts's re-export of ./client is not an issue today. Do not add a "./logger" entry to exports unless a third consumer needs one.

**Behaviour to keep the same.** 1. The log line must stay byte-identical. That means the same key order, the same message text "DB query executed", source "neon", the same 200-char threshold, and the "…" character (U+2026, not "..."). Copy the text rather than retyping it. An editor or formatter could normalize the character.
2. The timestamp is generated inside logQuery with new Date().toISOString(). Do not hoist it or cache it.
3. Both logger instances still log to console.log. Do not change this to console.info or a shared logger. Log collectors that match on stdout would see a difference.
4. Import path: "./logger" with no extension, matching the existing "./schema" style. tsconfig.base.json may use bundler resolution. Next's transpilePackages already handles the TS source for @dragonbot/db, and the new file sits in the same package.
5. Importing the class from client.ts or from index.ts would pull postgres-js into the Next bundle. Use only the standalone file.
6. The logger's single parameter ignores Drizzle's `params`. Do not "improve" that, for example by adding params or redaction. That would change behavior.
7. Query logging stays enabled in both clients. Logger instances are created per client creation. The web Proxy creates one lazily, so there is no change.

**Tests.** Existing coverage: none. The vitest tests under apps/bot/tests (events, lib, commands and db/honeypot.test.ts) mock or stub the DB. Nothing in the repo references NeonActivityLogger or the "DB query executed" string. packages/db has no test runner or tests. Typecheck and build are the main safety net.

Characterization tests to add before refactoring, in the bot's vitest setup (or a new packages/db test if vitest is added there):
1. Logger test. Spy on console.log with fake timers set to a fixed date. Call logQuery("select * from users") and assert the parsed JSON deep-equals {level:"info", msg:"DB query executed", source:"neon", timestamp:<fixed ISO>, command:"SELECT", query:"select * from users"}. Also assert the raw string key order.
2. Truncation test. A 201-char query yields the first 200 characters plus "…" (length 201). A 200-char query is unchanged.
3. Edge-case test. An empty string or leading-whitespace query gives command "" (query.split(/\s+/)[0] is "" and "" ?? "UNKNOWN" stays ""). Pin the current output exactly. Do not assume "UNKNOWN".
4. Wiring test, optional. The test would import both client modules and check that logger is passed to drizzle. This needs mocking drizzle-orm/postgres-js and drizzle-orm/neon-http, and a mock of the neon/postgres drivers. It is low value.

Write the tests against the current duplicated copies first, by importing each class via a temporary export. They would only be reachable after the move, so the simpler route is to land the logger test against the new logger.ts in the same change. Verify its expected output by running it on the old class copy pasted into the test once, then delete that copy. Then run the full bot suite plus typecheck and build of both apps.

### D11
**Server-only guard and AppError catch boilerplate repeated in most commands**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/bot/src/commands/admin.ts:58`, `apps/bot/src/commands/ask.ts:16`, `apps/bot/src/commands/leaderboard.ts:18`, `apps/bot/src/commands/membercount.ts:12`, `apps/bot/src/commands/next-birthdays.ts:21`, `apps/bot/src/commands/offtopic.ts:12`, `apps/bot/src/commands/rank.ts:15`, `apps/bot/src/commands/schedule.ts:30`, `apps/bot/src/commands/suggest.ts:17`, `apps/bot/src/commands/suggest.ts:69`, `apps/bot/src/commands/verify.ts:37`, `apps/bot/src/commands/verify.ts:99`, `apps/bot/src/commands/whois.ts:53`, `apps/bot/src/commands/birthday.ts:124`, `apps/bot/src/commands/xp-admin.ts:66`, `apps/bot/src/commands/xp-admin.ts:341`, `apps/bot/src/loader.ts:108`

**What the code does.** 11 commands repeat the 'This command can only be used in a server.' errorEmbed guard; ~8 sites repeat 'if (err instanceof AppError) editReply(errorEmbed(err.message)) else log + errorEmbed(Something went wrong.)' (3 more in admin.ts), each with its own fallback text. loader.ts already wraps every execute but replies with plain ephemeral text via followUp and does not special-case AppError.

**Verifier's notes.** I confirmed the core claim from the code. 11 command files (rank, verify, xp-admin, schedule, ask, admin, offtopic, leaderboard, suggest, membercount, next-birthdays) each repeat the same line: editReply({ embeds: [errorEmbed("This command can only be used in a server.")] }).

The AppError catch block is the same in 5 files: whois, verify, xp-admin, birthday and suggest. Each sends the AppError message in an embed, logs the error, then sends errorEmbed("Something went wrong."). Only the log call and its label differ (ctx.logger or log).

admin.ts:174, 191 and 257 handle AppError differently: they rethrow (`throw err`) to the loader rather than logging and showing the fallback embed. That part of the evidence is a little off, and the claim that each file has "its own fallback text" is wrong because the text is identical everywhere.

loader.ts:108-125 does wrap every execute call. On error it sends a plain-text ephemeral reply, or a followUp if already replied or deferred, and it has no AppError handling, as the finding says.

The duplication is real but shallow (about 3 to 6 lines each), and none of it is dead code or behaves differently in a meaningful way. Low impact and small effort are right.

**Fix plan.** Verified against the code. All 11 guard sites (rank, schedule, verify, admin, membercount, xp-admin, next-birthdays, ask, offtopic, suggest, leaderboard) use `await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] }); return;`. None of these commands set skipDefer, so editReply is always valid after the loader's auto-defer. There are 5 true catch-fallback sites: verify.ts:100, xp-admin.ts:342, whois.ts:54, birthday.ts:125 and suggest.ts:70. Each is `if (err instanceof AppError) { editReply(errorEmbed(err.message)); return; } <log>.error(...); editReply(errorEmbed("Something went wrong."))`. The "Something went wrong." text is identical at all 5. Only the logger and log message differ. verify, birthday and suggest-mod-notes use `log` or `ctx.logger` with different message strings, and xp-admin also logs `{ sub }`. The 3 admin.ts sites (174, 191, 257) are different: they handle AppError and then `throw err`, so the loader's followUp path handles the rest. They are not the same pattern as the others.

Plan:
1. Create apps/bot/src/utils/command-helpers.ts (it does not exist yet).
   - `requireGuild(interaction): Promise<boolean>`. It calls editReply with the same embed and returns false when `!interaction.guildId`. Use it as `if (!(await requireGuild(interaction))) return;`. The variant for next-birthdays, membercount and similar keeps an `interaction.guild` check inline, or takes an option `{ needGuildObject: true }`.
   - `replyAppErrorOrFail(interaction, err, onUnhandled: () => void): Promise<void>`. It sends `errorEmbed(err.message)` for an AppError. Otherwise it runs the caller's `onUnhandled` log callback and then sends `errorEmbed("Something went wrong.")`. The callback keeps each site's exact logger and message. The signature proposed in the finding, `(interaction, err, log, label)`, would change the log message text, so use the callback form or pass the full message string.
   - A third helper, `rethrowUnlessAppError`, is optional for admin.ts. I recommend skipping it. It would save only about 4 lines per site.
2. Migrate one command per commit, starting with the pure guards (offtopic, ask, rank, leaderboard, membercount, next-birthdays, then the others). Then migrate the 5 catch sites.
3. Do NOT touch loader.ts, and do not centralize in the loader. schedule and ask do not catch AppError today, so the loader would change their replies (plain ephemeral followUp text vs an embed). Drop loader.ts:108 from the finding's locations.
4. Leave the admin.ts rethrow sites alone, or migrate them only with a rethrow-preserving helper.
Net saving is about 40 lines. Impact is low, so it is optional.

**Behaviour to keep the same.** 1. The guard must stay on editReply after the loader's deferReply. Never use reply, and never call requireGuild on skipDefer commands (mod, poll, latex, roll). Their reply semantics differ, so editReply would throw there.
2. Ephemerality is set by the loader's defer (command.ephemeral), not by editReply. The helpers must not pass flags, or the ephemerality of verify, xp-admin, birthday, admin and schedule would change.
3. Guard predicates differ. Most commands check `!interaction.guildId`. membercount checks `!interaction.guild`. next-birthdays checks `!interaction.guildId || !interaction.guild`. Collapsing these into one predicate changes behaviour in cached or uncached guild edge cases, for example a guild-install interaction where the guild is not cached.
4. Log text and fields differ per site: `log` (child logger with command, guildId and userId bindings) vs `ctx.logger`, the messages "Unhandled error in /verify", "Error in /whois", "Error in /xp-admin" and so on, and `{ sub }` in xp-admin. Changing these breaks log search or alerting. Pass the logger call in as a callback.
5. Order matters: AppError is checked before any logging, so AppErrors must stay unlogged. The "Something went wrong." embed (no "Please try again later") differs from the loader's plain-text fallback. Do not unify them.
6. The 3 admin.ts sites rethrow non-AppErrors and rely on the loader. Making them reply with "Something went wrong." would change behaviour: the loader currently logs "Unhandled error in command" and sends an ephemeral followUp.
7. schedule and ask have no AppError catch today. Do not add one.
8. If a command's catch sits inside a larger try that also covers the guard, keep the control flow identical (return after reply).
9. errorEmbed must be imported from utils/embeds.ts. Watch for a circular import if the helpers file imports embeds.

**Tests.** Existing coverage: only apps/bot/tests/commands/suggest.test.ts covers commands. None cover the guard or the catch pattern for the other commands. Check suggest.test.ts first for a mock-interaction harness to reuse. No loader tests exist.

Characterization tests to add BEFORE refactoring:
- tests/utils/command-helpers.test.ts for the new helpers, written in the same commit as the helpers:
  - requireGuild returns false and calls editReply once with the exact embed description "This command can only be used in a server." when guildId is null, and returns true with no reply otherwise.
  - The AppError path replies with err.message and does not call the logger.
  - The non-AppError path calls the log callback once and replies with "Something went wrong.".
- One parameterised test across the 11 commands. Build a mock interaction with guildId null, call `command.execute`, and assert editReply is called once with the embed text and that no service was touched. Run it against the current code first to lock the behaviour, then run it again after each migration.
- Per-command catch tests for verify, xp-admin, whois, birthday and suggest. Mock a service to throw an AppError, then a generic Error. Assert the editReply text and the logger call (level, message, fields).
- Edge case: membercount and next-birthdays with guildId set and guild null.
Run `pnpm --filter bot test` and typecheck after each migrated command.

### D12
**Verification-role assignment written three times with different error handling**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/bot/src/commands/verify.ts:66`, `apps/bot/src/commands/verify.ts:88`, `apps/bot/src/events/guild-member-add.ts:16`

**What the code does.** Each site reads settings.verificationRoleId, fetches/uses the member and calls roles.add. /verify code and guildMemberAdd swallow and warn on failure; /verify sync lets the error reach the generic 'Something went wrong.' catch.

**Verifier's notes.** The finding holds. verify.ts lines 66-74 (/verify code) and 88-92 (/verify sync) each call getSettings, check verificationRoleId and interaction.guild, fetch the member and call roles.add. The code path wraps this in try/catch with log.warn. The sync path has no inner try/catch, so a failure reaches the outer catch, which logs an error and replies "Something went wrong." guild-member-add.ts lines 16-25 calls roles.add on the member it is given (no fetch) inside try/catch with log.warn, and it also checks isVerificationSyncEnabled and isVerified first. So the repetition exists and the error handling does differ. The repeated core is about two lines (fetch plus roles.add), and the guards differ between callers, so the duplication is small and a shared helper would save little. Impact low, effort S, and the stated behaviour risk is accurate.

**Fix plan.** A behavior-preserving fix exists, but only as a narrow extraction. The three sites share just one line, `roles.add(roleId)`. They differ in how they get the member, which conditions guard the call, what they log and how they handle errors.

Do not merge the three sites into one helper that owns the try/catch. The only unification that preserves behavior is a helper that does the add and throws.

1. Add a small helper, for example `apps/bot/src/utils/verification-role.ts`:
   `export async function addVerificationRole(guild: Guild, userId: string, roleId: string): Promise<void> { const member = await guild.members.fetch(userId); await member.roles.add(roleId); }`
   It has no try/catch, no logging and no settings or verified checks.
2. Update `apps/bot/src/commands/verify.ts` (`code` and `sync` branches only).
   - `code`: keep the `getSettings` call, the `guild?.verificationRoleId && interaction.guild` guard, and the `try { await addVerificationRole(interaction.guild, interaction.user.id, guild.verificationRoleId) } catch (err) { log.warn({ err }, "Failed to assign verification role") }`. The log message string and `{ err }` shape stay exactly the same.
   - `sync`: call the helper with no try/catch, so errors still reach the outer catch and show "Something went wrong." (or the AppError message).
3. Leave `apps/bot/src/events/guild-member-add.ts` alone, or convert it only if the helper accepts an already-held `GuildMember`. That site calls `member.roles.add` on the member from the event and does no fetch. Routing it through a `members.fetch` helper would add a REST or cache call that does not happen today, and would break any mock that has no `guild.members.fetch`. The cleaner choice is to leave it, or to give the helper an overload that takes a `GuildMember` (`await member.roles.add(roleId)`) and have the `verify.ts` callers do the fetch first.
4. Do not move the helper into the verification or user service. Those services have no discord.js `Guild` in scope, so putting it there would make the layers depend on Discord objects. A utils function is the better place.

Realistic payoff: this removes about 4 duplicated lines. Consider skipping it unless other verification work is already under way, as the finding itself says.

**Behaviour to keep the same.** Differences to keep intact:

- Error handling:
  - `/verify code` and `guildMemberAdd` swallow the error and log a warning.
  - `/verify sync` does not catch. A failed role add reaches the outer catch, which shows "Something went wrong." and logs `log.error({ err }, "Unhandled error in /verify")`.
  - If the failure were an AppError, the user would see its message instead. A helper that internally catches would turn sync failures into a false "synced" success message.
- Log text and level: `/verify code` warns "Failed to assign verification role". `guildMemberAdd` warns "Failed to sync verification role" and logs info "Auto-synced verification role" on success. `/verify` logs no success message for the role add. The `log` child bindings also differ (command/sub versus event).
- Member acquisition: `/verify` does `interaction.guild.members.fetch(userId)`. `guildMemberAdd` uses the event's `member` directly, with no fetch. In `/verify code`, a fetch failure is also swallowed, because the fetch sits inside the try. In `/verify sync`, a fetch failure propagates.
- Guards differ:
  - `/verify` checks `guild?.verificationRoleId && interaction.guild`. It does not check `isVerificationSyncEnabled`, so it works even when sync is off.
  - `guildMemberAdd` requires `isVerificationSyncEnabled && verificationRoleId`, then `isVerified`, then the add.
  - `/verify sync` checks `isVerified` first, and an unverified user gets an error embed. The `code` path does not check isVerified, because the user was just confirmed.
- Ordering: in `/verify code` the role is added before the info log "Verification confirmed" and before the success embed. In `guildMemberAdd` it happens before the welcome message and the DM. Keep those positions.
- `getSettings` is called once per path. Hoisting or caching it would change the number of calls. This is also a possible race with the ephemeral reply and the `ctx.services.guild` cache.
- A helper accepting a `Guild | null` could change the `interaction.guild` null behavior, which currently skips silently.
- The role-add failure path (for example a bot with too little hierarchy permission) is the most likely thing to regress. The three behaviors are swallow and warn, swallow and warn, and propagate.

**Tests.** Existing coverage:
- `apps/bot/tests/events/guild-member-add.test.ts` has 2 tests, both about the welcome channel and its cross-guild check. The setup hard-codes `isVerificationSyncEnabled: false`, so the verification-role branch in `guildMemberAdd` is not covered. The finding's note that "guild-member-add has a test" is therefore misleading for this logic.
- `apps/bot/tests/commands/` contains only `suggest.test.ts`, so `verify.ts` has no test.
- `apps/bot/tests/services/` has no verification or user service test. The services are not touched by this refactor anyway.

Characterization tests to write first, against the current code:
1. `apps/bot/tests/commands/verify.test.ts`, mocking `interaction` (`options.getSubcommand`, `getString`, `editReply`, `guildId`, `guild.members.fetch`, `user.id`) and `ctx.services.{verification,guild,user}`:
   - `code`, role configured and add succeeds: `roles.add` is called with the role id, the success embed says "You have been verified!", and `log.warn` is not called.
   - `code`, `roles.add` rejects: the reply is still the success embed, and `log.warn` is called with `expect.objectContaining({ err })` and "Failed to assign verification role".
   - `code`, `members.fetch` rejects: same swallow-and-warn result.
   - `code`, no `verificationRoleId`, or `interaction.guild` is null: `fetch` is not called.
   - `sync`, not verified: the error embed "You are not verified. Use `/verify email` first." is shown and `roles.add` is not called.
   - `sync`, add succeeds: the success embed "Your verification has been synced to this server!" is shown.
   - `sync`, `roles.add` rejects: the reply is the "Something went wrong." embed and `log.error` is called. This is the key test that guards the behavior risk.
   - `sync`, `fetch` rejects: same as the previous case.
   - AppError thrown anywhere: the reply uses `err.message`.
2. Extend `guild-member-add.test.ts` with a configurable settings object:
   - sync enabled, role set and user verified: `member.roles.add(roleId)` is called, `log.info("Auto-synced verification role")` is logged, and `members.fetch` is not used.
   - `roles.add` rejects: the error is swallowed, `log.warn` is called with "Failed to sync verification role", and the welcome message is still sent afterwards.
   - sync disabled, no role, or user not verified: `roles.add` is not called.
3. If the helper is added, add a short unit test: it fetches the member and calls `roles.add(roleId)`, and it propagates rejections from either call.

Run `pnpm --filter bot test` (vitest) and typecheck before and after the refactor. The characterization tests must pass unchanged against both the old and new code.

### D13
**Birthday month names and next-occurrence year computed twice**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/bot/src/services/birthday.service.ts:4`, `apps/bot/src/services/birthday.service.ts:71`, `apps/bot/src/commands/next-birthdays.ts:10`, `apps/bot/src/commands/next-birthdays.ts:54`

**What the code does.** MONTH_NAMES is declared in both files. getUpcomingBirthdays decides whether this year's birthday has passed to pick the target date, and next-birthdays recomputes the same year with the same month/day comparison to label groups.

**Verifier's notes.** I confirmed this from the code. The same MONTH_NAMES array is declared at birthday.service.ts:4 and next-birthdays.ts:10. getUpcomingBirthdays (service lines 64-78) moves the target date to next year when `b.birthMonth < todayMonth || (b.birthMonth === todayMonth && b.birthDay < todayDay)`. next-birthdays.ts:55-59 repeats that exact comparison to work out the year for each group label. Its extra `daysUntil === 0 ? currentYear` branch changes nothing: a birthday today never satisfies the "already passed" check, so both paths give the same year. The only difference is that each file calls `new Date()` separately, which could disagree for a moment around midnight on New Year's Eve. The proposed refactor (return targetYear and export MONTH_NAMES) keeps behaviour the same and would remove that small race. The duplication is real, but it is small and in display code, so the impact is low.

**Fix plan.** Files: apps/bot/src/services/birthday.service.ts and apps/bot/src/commands/next-birthdays.ts only. The only consumer of getUpcomingBirthdays/UpcomingBirthday is next-birthdays.ts (confirmed by grep). The birthday.ts command uses formatBirthday, which stays untouched.

1. Service: change `const MONTH_NAMES` to `export const MONTH_NAMES`.
2. Service: add `targetYear: number` to UpcomingBirthday. In getUpcomingBirthdays, make the year explicit instead of reading it back from the Date: `let targetYear = thisYear; if (passed) targetYear = thisYear + 1; const targetDate = new Date(targetYear, b.birthMonth - 1, b.birthDay);`. Keep the passed condition (`month < todayMonth || (month === todayMonth && day < todayDay)`) exactly as is, and keep the daysUntil formula and `new Date(thisYear, todayMonth - 1, todayDay)` as is. Return `targetYear` in the result object. Do not use targetDate.getFullYear(). It would match for every input today, but an explicit variable is easier to reason about.
3. Command: delete the local MONTH_NAMES. Import `MONTH_NAMES` from "../services/birthday.service.js" (the repo uses .js import suffixes). Delete the `now`/`currentYear` locals and the nested year ternary. Use `const year = b.targetYear;`. Leave the `?? "Unknown"` fallback, the padStart(2,"0") on day (the command pads the day, whereas formatBirthday does not), the `key` format, the Map insertion order, and the mention format unchanged.
4. Do NOT replace the command's label with service.formatBirthday. It does not pad the day and has different output.

Note on the proposed fix's `daysUntil===0` guard: the guard in the command is redundant. daysUntil===0 happens only when the birthday is today, and that is never "passed", so year is already the current year. Dropping it is behavior-preserving, but it can optionally be kept as a comment. Dropping the command's second `new Date()` also removes a tiny midnight-rollover race between the two calls. That is a harmless, arguably beneficial difference, but it is a change, so mention it in the PR.

**Behaviour to keep the same.** - Time zone: both places use local-time Date getters (getFullYear/getMonth/getDate) and the local-time Date constructor. Do not switch to UTC or toISOString.
- Feb 29 in a non-leap year: new Date(2027,1,29) rolls to Mar 1. With today = Feb 28, 2027 and a Feb 29 birthday, the birthday is not 'passed', so targetYear=2027 and daysUntil=1. The command currently labels the group "February 29, 2027" and keys it "2027-02-29". Keep this quirk. If today is Mar 1 or later, the year is 2028. Using the explicit targetYear variable (not targetDate.getFullYear(), not a re-derived leap-year check) preserves it exactly.
- Year-end: Dec 31 vs Jan 1 boundaries. Today Dec 31 with a Jan 1 birthday gives month < todayMonth, so thisYear+1. A Dec 31 birthday on Dec 31 gives daysUntil 0 and the current year.
- DST: daysUntil uses Math.round over ms differences; keep Math.round so DST days of 23 or 25 hours still produce integers.
- Grouping key and ordering: the Map keys on year-month-day with insertion order following the sorted daysUntil. The sort is stable and ties keep repository order, so do not reorder or re-sort.
- The two year computations use separate `now` values today. After the change there is one, so a request straddling midnight could no longer disagree. This is a negligible improvement and is the only observable difference.
- Day padding: the command shows "March 05, 2027" while formatBirthday shows "March 5". Do not unify them.
- UpcomingBirthday gains a field. Any test mock or object literal that builds UpcomingBirthday (none exist today) would need the new field.
- Exporting MONTH_NAMES from a service file is a slight layering oddity. It could go in a small utils module instead (same behavior). It is not required.

**Tests.** Existing coverage: none for this code. apps/bot/tests has no birthday.service or next-birthdays tests. apps/bot/tests/lib/birthday-checker.test.ts mocks BirthdayService (cast as unknown) and never calls getUpcomingBirthdays. The test runner is vitest (`pnpm --filter bot test`, i.e. `vitest run`).

Add BEFORE refactoring (characterization tests, passing on current code, then re-run after the change):

1. tests/services/birthday.service.test.ts with a fake BirthdayRepository (getAllBirthdays) and vi.useFakeTimers() + vi.setSystemTime(new Date(2026, 5, 15)), so the time is local (month index 5). Assert on current output for getUpcomingBirthdays:
 - A birthday today gives daysUntil 0.
 - Yesterday's birthday gives a daysUntil around 364 (next year).
 - Tomorrow's birthday gives 1.
 - Dec 31 and Jan 1 around year-end, with the system time set to Dec 31 and to Jan 1.
 - Feb 29 with the system time at Feb 28, 2027 (a non-leap year; expect daysUntil 1) and at Mar 1, 2027 (expect about 365, with the target in 2028).
 - Members not in memberIds are filtered out.
 - The result is sorted ascending and truncated to `count`.
 - Ties keep the repository order.
 After the change, extend these assertions with `targetYear` (equal to the current year, or +1 when passed). In the pre-refactor run, compute the expected year independently from the same rule.
2. A MONTH_NAMES check: length 12, first and last entries.
3. tests/commands/next-birthdays.test.ts, modeled on tests/commands/suggest.test.ts: mock ctx.services.guild.getSettings, interaction.guild.members.fetch (a Map with displayName), and ctx.services.birthday.getUpcomingBirthdays (return fixed rows with and without targetYear). Capture the editReply embed description and assert exact strings. For example: "**June 15, 2026**\n> <@id> (Name)" for a today birthday, a next-year label for a passed one, the day zero-padded ("March 05, 2027"), grouping of two users on the same date under one header, and a user absent from members rendering as a bare mention. Also assert the guard branches (not in a guild, birthdays disabled, empty list, error path). Because the command today derives year from fake timers, pin the system time. After the refactor, the mocked service rows must include targetYear consistent with the daysUntil.
4. Run `pnpm --filter bot test` and `pnpm -r typecheck` (or tsc) before and after. Compare outputs with an identical-snapshot approach if practical.

### D15
**Three cron-to-text formatters (bot command, schedules page, CronBuilder)**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/bot/src/services/scheduled-message.service.ts:63`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:41`, `apps/web/src/components/cron-builder.tsx:143`

**What the code does.** The schedules page's cronToHuman is a shortened copy of the bot's, and CronBuilder's describeCron is a third, fuller version. All repeat the same 12-hour time formatting, but their output strings differ on purpose ("Every hour" / "Hourly" / "Every hour, every day").

**Verifier's notes.** I confirmed the finding against the code. I found three cron-to-text formatters at the cited lines: cronToHuman in scheduled-message.service.ts at line 63, the local cronToHuman in the schedules page at line 41, and describeCron in cron-builder.tsx at line 143.

- **Shared logic:** all three use the same 12-hour formula: `period = h >= 12 ? PM : AM`, `h12 = h === 0 ? 12 : h > 12 ? h - 12 : h`, and minutes padded to two digits. CronBuilder puts a space before AM/PM ("9 AM"); the other two do not ("9AM").
- **Different output:** each formatter produces deliberately different text ("Every hour" / "Hourly" / "Every hour, every day"; "Every 30 minutes" / "Every 30 min"; "Mondays at" / "Mon"). CronBuilder also handles lists of days, ranges and weekends, which the other two do not.

This matches the finding: merging the whole formatters would change text users see. Extracting only the time helper with a spacing option is safe. The duplicated part is about four lines, kept in step only by convention, so low impact and small effort are right.

**Fix plan.** Verified against the code: the 12-hour block is character-identical in bot cronToHuman (scheduled-message.service.ts:~74-77) and web schedules/page.tsx cronToHuman (~line 52-55). It is "5PM" / "5:30PM" with no space. CronBuilder's formatTime (inside describeCron, ~line 166) is the same logic but emits a space before the period ("5 PM", "5:30 PM"). No cronToHuman/describeCron test exists anywhere (bot's scheduler.test.ts does not reference them). The fix is behavior-preserving if limited to the time formatting.

Steps:
1. Add apps/web/src/lib/format-time.ts exporting `formatTime12h(h: number, m: number, opts?: { spaced?: boolean }): string`. Body: period = h>=12?"PM":"AM"; h12 = h===0?12:h>12?h-12:h; sep = spaced?" ":""; return m===0 ? `${h12}${sep}${period}` : `${h12}:${String(m).padStart(2,"0")}${sep}${period}`.
2. In schedules/page.tsx replace the inline period/h12/timeStr with `const timeStr = formatTime12h(h, m)`. Keep every other branch and string ("Hourly", "Daily ${timeStr}", "Sun" etc.) as is.
3. In cron-builder.tsx replace the local formatTime closure with `formatTime12h(hour, min, { spaced: true })` and delete the closure. Leave describeDays, describeCron strings and parseCron untouched.
4. Bot: apps/bot cannot import from apps/web, and the helper is about 3 lines. Either leave the bot copy as is (recommended; this means only 2 of 3 copies merge, so the net duplication saved is small) or put the helper in packages/db (not appropriate: that package is schema and clients) or a new shared package (over-engineering for this finding). If the user wants all three merged, the bot gets its own tiny local `formatTime12h` in the same file with no cross-package change.
5. Do NOT merge the three formatters; their different strings are intentional (bot: "Every 5 minutes", "Weekdays at 9AM"; page: "Every 5 min", "Weekdays 9AM"; builder: "Every 5 minutes, weekdays", "At 9 AM, weekdays").
Honest value assessment: about 4 lines of savings per site, so this is low value. It is acceptable to close the finding as "won't fix" if the user prefers zero churn.

**Behaviour to keep the same.** 1. Spacing: bot and page need NO space before AM/PM; CronBuilder needs a space. Default `spaced` must be false, and CronBuilder must pass true. Getting this wrong changes Discord and dashboard text.
2. Input parsing must stay per call site. The bot and page use parseInt with `!isNaN` guards, so "9abc" parses as 9 and "" gives NaN. CronBuilder uses Number, so "" becomes 0 and "9abc" is NaN, and it gates on its own earlier checks. Do not move parsing into the helper or unify it. The helper takes already-parsed numbers only.
3. Out-of-range values (h > 23, m > 59, negative, fractional) currently pass straight through the arithmetic, e.g. h=25 gives "13PM". The helper must reproduce this exactly, with no validation or clamping added.
4. Midnight and noon: h=0 gives "12AM", h=12 gives "12PM", h=13 gives "1PM". Keep the `h > 12 ? h - 12` ordering.
5. m===0 omits minutes. Minutes use padStart(2,"0"). In the page and bot, m comes from parseInt, so "05" and "5" both give ":05".
6. Whitespace splitting: bot and page use split(" "), the builder uses trim().split(/\s+/). Do not unify, because it changes how extra spaces are handled (the 5-part check).
7. The web helper must be a plain module with no "use client" requirement. Both consumers are client components, so a plain import is fine.

**Tests.** Existing coverage: none. No test references cronToHuman, describeCron or the time formatting. The bot has vitest (apps/bot/tests, e.g. tests/lib/scheduler.test.ts, which does not touch these functions). apps/web has no test runner at all.
Characterization tests to add BEFORE refactoring, each pinned to the current output:
- Bot (vitest, tests/services/scheduled-message.cron-to-human.test.ts): cronToHuman is already exported, so test it directly. Cases: "0 9 * * *" gives "Daily at 9AM"; "30 17 * * 1-5" gives "Weekdays at 5:30PM"; "0 0 * * 0" gives "Sundays at 12AM"; "0 12 * * 6" gives "Saturdays at 12PM"; "5 13 * * *" gives "Daily at 1:05PM"; "*/15 * * * *" gives "Every 15 minutes"; the 5-field guard and the passthrough of unparseable input.
- Web: describeCron and the page's cronToHuman are not exported. Either (a) export them temporarily or via the new module and add a vitest dev dependency to apps/web (extra scope, so ask first), or (b) snapshot the strings manually by running them in a scratch script before and after. The same input matrix applies. For describeCron, expect "At 9 AM, every day", "At 5:30 PM, weekdays", "At 12 AM, every day", "At 12 PM, every day". For the page version, expect "Daily 9AM", "Weekdays 5:30PM" and "Mon 12PM".
- The new formatTime12h unit test would cover both `spaced` modes over h in 0..23 and m in {0, 5, 30}, plus the out-of-range passthrough.
After the refactor, re-run the same matrix and diff for byte-identical output, then run `pnpm turbo test` and the web typecheck/build.

### D4
**Shared contracts and patterns copied by hand: log event names (3 copies), suggestion statuses, UUID_RE (3), YouTube channel regex (2), snowflake regex, DiscordChannel type (3), timezone list (2)**

Impact **low** (the finder said medium) · Effort **S** · Category duplication

Locations: `apps/bot/src/services/logging.service.ts:6`, `apps/web/src/lib/validators.ts:4`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:63`, `apps/web/src/app/api/server/[guildId]/suggestions/[suggestionId]/route.ts:10`, `apps/web/src/app/api/server/[guildId]/suggestions/[suggestionId]/route.ts:12`, `apps/web/src/app/dashboard/server/[guildId]/suggestions/page.tsx:16`, `apps/web/src/app/api/server/[guildId]/schedules/[scheduleId]/route.ts:11`, `apps/web/src/app/api/server/[guildId]/youtube/[subscriptionId]/route.ts:11`, `apps/web/src/app/api/server/[guildId]/youtube/route.ts:11`, `apps/web/src/app/api/server/[guildId]/youtube/resolve/route.ts:54`, `apps/web/src/lib/validators.ts:99`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:17`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:22`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:28`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:890`

**What the code does.** LogEventType (bot), VALID_LOG_EVENTS (web zod) and LOG_EVENT_OPTIONS (dashboard) each hard-code the same 9 strings; the bot logs only when guild.logEvents.includes(eventType), so a missed edit means an event can never be enabled or orphan values linger in the DB. Suggestion statuses appear in the API enum and three places in the page. UUID_RE is identical in three routes; /^UC[\w-]{22}$/ appears twice; validators.ts:99 rewrites DISCORD_SNOWFLAKE_RE (defined at :40). DiscordChannel is declared in three pages; the timezone list is inlined twice. PERMISSION_SCOPES and HONEYPOT_ACTIONS already show the shared-contract pattern in packages/db.

**Verifier's notes.** I checked every cited copy in the code and all of them exist as described. The same 9 log event strings, in the same order, appear in three places: LogEventType in apps/bot/src/services/logging.service.ts:6, VALID_LOG_EVENTS in apps/web/src/lib/validators.ts:4, and LOG_EVENT_OPTIONS in dashboard/server/[guildId]/page.tsx:63. The UUID_RE regex is byte-identical in 3 routes (suggestions, schedules and youtube [id] routes). The regex /^UC[\w-]{22}$/ appears in youtube/route.ts:11 and youtube/resolve/route.ts:54. validators.ts:99 repeats /^[0-9]{17,20}$/ even though DISCORD_SNOWFLAKE_RE is defined at :40. The interface DiscordChannel {id,name,type} is identical in 3 pages, and a fourth copy sits in api/.../discord/route.ts. The 10-entry timezone list is inlined at page.tsx:890 and again as TIMEZONES in schedules/page.tsx. packages/db's exports are only '.', './schema' and './serverless', so the proposed subpath export would be new, which the fix already accounts for. One correction: the suggestion statuses are not plain copies. The page's STATUS_OPTIONS deliberately leaves out 'archived', so only the full list (the StatusFilter type and the filter array) duplicates the API enum, and any shared constant must keep that subset. Nothing here is dead or behaving differently, so the duplication claim stands. I rate the impact lower than medium. Only the log events cross the bot/web boundary with no compile-time link, and those lists are small and stable. The rest are tidy-ups that carry little risk.

**Fix plan.** Verified against the code. Corrections to the finding first, so the plan is scoped accurately:
- Log events: the 9-string lists are real and identical in order in apps/bot/src/services/logging.service.ts:6 (union type), apps/web/src/lib/validators.ts:4 (VALID_LOG_EVENTS, used at :112 in z.enum) and apps/web/src/app/dashboard/server/[guildId]/page.tsx:63 (LOG_EVENT_OPTIONS, mapped to checkboxes at :477).
- Suggestion statuses: the API route has VALID_STATUSES with 5 values (pending, approved, rejected, completed, archived). The page has a StatusFilter type, a 4-value STATUS_OPTIONS (archived deliberately excluded) and a STATUS_COLORS record, plus an inline filter array at :122 (all + 5). These are NOT identical lists. Only the 5-value list is shareable. Keep STATUS_OPTIONS as a separate 4-value subset, e.g. SUGGESTION_STATUSES.filter(s => s !== "archived"), or leave it alone. The DB column is plain text defaulting to "pending" (schema.ts:148), so no schema change.
- Timezones: one TIMEZONES const in schedules/page.tsx:28 (used twice, at :289 and :379), plus one inline identical 10-element list at page.tsx:890. Same 10 values in the same order.
- DiscordChannel: the three client copies (page.tsx:51, schedules/page.tsx:22, youtube/page.tsx:17) are identical ({id,name,type:string}). The one in api/server/[guildId]/discord/route.ts:10 has a different shape (type:number, position, parent_id) and is server-side. Do NOT merge it.
- UUID_RE is identical in 3 routes (schedules/[scheduleId], youtube/[subscriptionId], suggestions/[suggestionId]).
- YOUTUBE_CHANNEL_ID_RE exists at youtube/route.ts:11 (anchored). resolve/route.ts:54 inlines the same anchored regex. The 5 unanchored, capturing patterns at resolve/route.ts:121-137 are different on purpose. Leave them.
- Snowflake: validators.ts:99 inlines /^[0-9]{17,20}$/, identical to DISCORD_SNOWFLAKE_RE at :40 (declared earlier, so no TDZ problem).

Steps (do in this order, typecheck between):
1. Create packages/db/src/log-events.ts, with no imports: `export const LOG_EVENTS = ["member_join","member_leave","message_delete","message_edit","role_change","nickname_change","voice_activity","kick","ban"] as const; export type LogEventType = (typeof LOG_EVENTS)[number];`. Add `"./log-events": "./src/log-events.ts"` to packages/db/package.json exports. The web app already has transpilePackages for @dragonbot/db, so a subpath .ts export resolves like ./schema and ./serverless do.
2. Bot: in logging.service.ts replace the union with `import type { LogEventType } from "@dragonbot/db/log-events"` and keep `export type { LogEventType }` so existing importers do not break (grep for importers first). Check that the bot's module resolution (NodeNext or bundler) honours the subpath export. The bot already imports @dragonbot/db, so it likely does; confirm with tsc and vitest.
3. Web validators.ts: import LOG_EVENTS from "@dragonbot/db/log-events" and use `z.enum(LOG_EVENTS)` at :112. Delete VALID_LOG_EVENTS. Note: validators.ts imports the @dragonbot/db root (HONEYPOT_ACTIONS), so it must stay server-only. Do not import validators.ts from client pages, because it would pull in postgres. For the client page use the subpath import.
4. Dashboard page.tsx: `import { LOG_EVENTS } from "@dragonbot/db/log-events"` and `const LOG_EVENT_OPTIONS = LOG_EVENTS` (or use directly). Do NOT import the root.
5. Suggestions: add `SUGGESTION_STATUSES` (5 values, current order) plus a type. Put it in a new subpath file (e.g. packages/db/src/suggestion-statuses.ts) or in log-events.ts renamed to a generic `contracts.ts`, so that the client suggestions page can import it without the root. Use it in [suggestionId]/route.ts z.enum; in the page derive StatusFilter and the filter-tab array from it.
6. apps/web/src/lib/validators.ts: export UUID_RE and YOUTUBE_CHANNEL_ID_RE (same literals, same /i flag on UUID); update the 3 UUID routes, youtube/route.ts and resolve/route.ts:54 to import them. Replace `/^[0-9]{17,20}$/` at :99 with DISCORD_SNOWFLAKE_RE. Careful: these are module-level exports that routes already import from validators, so there is no client-bundle concern. Shared non-global regex objects are safe with .test() because there is no g flag, so no lastIndex statefulness. Keep it that way.
7. New apps/web/src/lib/discord-types.ts exporting `DiscordChannel` (type-only, erased at build) and apps/web/src/lib/timezones.ts exporting TIMEZONES (as const or string[] with the same 10 values and order). Update the 3 pages and the inline list at page.tsx:890. Leave the server-side route DiscordChannel alone.
8. Run pnpm typecheck, the bot vitest suite, and next build (confirms no postgres in the client bundle).

**Behaviour to keep the same.** - Array order drives the dashboard checkbox order and the timezone dropdown order. Preserve exactly (currently identical across copies). Values must match byte for byte; a typo silently changes what zod accepts or what the bot matches.
- The client/server boundary matters most. Importing @dragonbot/db root, or validators.ts (which imports it), into a 'use client' page would pull postgres into the browser bundle and break the build or runtime. Only the dependency-free subpath modules may be imported client-side. A type-only DiscordChannel is erased, so it is safe anywhere.
- z.enum with a readonly `as const` tuple behaves identically to the local literal. Error messages and accepted values are unchanged. If a plain string[] were used, typing would widen and z.enum would reject at compile time. Keep `as const`.
- Making LogEventType derived must keep the same members. Re-export it from logging.service.ts so existing imports remain valid. The bot's runtime behavior (guild.logEvents.includes(eventType)) is untouched. The DB column is a text array, so existing rows are unaffected.
- Suggestion statuses: the page's 4-value STATUS_OPTIONS excludes archived on purpose. Collapsing it into the API's 5-value list would add an "archived" option to the status dropdown, a visible behavior change. STATUS_COLORS is a UI mapping and stays local.
- Do not unify the server-side DiscordChannel (type:number) with the client one (type:string). Do not replace the unanchored capture regexes in resolve/route.ts with the anchored YOUTUBE_CHANNEL_ID_RE; the anchoring differs and extraction would break.
- UUID_RE must keep the /i flag; the regexes must stay non-global to avoid lastIndex statefulness across requests.
- Module resolution: the new subpath export must resolve under the bot's TS config and Next's transpilePackages (the same mechanism ./schema and ./serverless already use). Verify via tsc and a real next build, not only the dev server.

**Tests.** Existing coverage: apps/bot/tests/services/logging.service.test.ts exercises shouldLog and sendLogEmbed with string literals (it ran as the only guard for log events, and will keep passing). The bot has tests for guild-ban-add, member-add, member-remove, message-delete and similar events, which cover the consumers of LogEventType at runtime. The web app has no test suite (no tests are tracked under apps/web), and there are none for validators, the routes or the pages. Nothing covers the zod enums, the UUID or YouTube regexes, or the dashboard option lists.

Add before refactoring (characterization, small and cheap):
1. packages/db or apps/bot test snapshotting `LOG_EVENTS` equals the exact 9-element ordered array (guards values and order; also run it against the old copies by asserting the literals first).
2. Validator tests (vitest would need to be added to apps/web, or placed where vitest already runs): guildSettingsUpdateSchema accepts each of the 9 log events and rejects an unknown one and "" ; the birthday/ID fields accept 17- and 20-digit snowflakes and reject 16 and 21 digits and non-digits; suggestion PATCH schema accepts the 5 statuses and rejects others.
3. Regex tests: UUID_RE accepts upper/lower-case UUIDs and rejects malformed ones; YOUTUBE_CHANNEL_ID_RE accepts UC + 22 chars of [\w-] and rejects 21 or 23 chars and missing UC prefix.
4. A type-level or runtime check that TIMEZONES has the 10 expected entries in order, and that the SUGGESTION_STATUSES-derived filter tabs equal ["all","pending","approved","rejected","completed","archived"] and the dropdown equals the 4-value list without archived.
5. Post-change gates: `pnpm typecheck` across the monorepo, the full bot vitest suite, and `next build` for apps/web (guards the client-bundle boundary). Manually confirm the dashboard Logging checkbox order and the timezone selects are unchanged.

### D6
**Leaderboard query and table written twice (public and dashboard)**

Impact **low** (the finder said medium) · Effort **S** · Category duplication

Locations: `apps/web/src/app/api/leaderboard/[guildId]/route.ts:28`, `apps/web/src/app/api/server/[guildId]/leaderboard/route.ts:30`, `apps/web/src/app/leaderboard/[guildId]/page.tsx:7`, `apps/web/src/app/leaderboard/[guildId]/page.tsx:65`, `apps/web/src/app/dashboard/server/[guildId]/leaderboard/page.tsx:7`, `apps/web/src/app/dashboard/server/[guildId]/leaderboard/page.tsx:74`

**What the code does.** Both API routes run the same userXp select, top-100 order, resolveDiscordUsers and displayName/avatar mapping (~22 identical lines). Both pages declare the same LeaderboardEntry interface and ~45 lines of identical table markup (medals, avatar, level, XP, messages). Side note: /api/leaderboard/{id} is public while /api/server/{id}/leaderboard requires membership and returns the same data.

**Verifier's notes.** I confirmed the finding from the code. Both API routes contain the same block: a userXp select of discordId, totalXp, level, messageCount and xpMessageCount, ordered by totalXp descending and limited to 100. Each then calls resolveDiscordUsers and maps every row to displayName and avatarUrl with the same fallbacks. That is about 22 identical lines.

The two routes differ in the following ways. None of these affect the shared block, and all of them would stay outside it:
- **Public route:** looks up guildName and returns {guildName, entries}.
- **Dashboard route:** checks auth and guild membership, and returns a bare array.

A diff of the two pages shows the table markup is the same apart from indentation: header row, medal emojis, avatar or placeholder, level, XP, messages and XP-message columns. The only differences are in each page's wrapper:
- **Empty-state text:** each page has its own message.
- **Header:** the public page has an Image header and a guildName; the dashboard page has an isAdmin back link.
- **Loading and error layout:** handled differently on each page.
- **Footer note:** each page has its own.

The proposed fix keeps all of these per page. Medium impact is a little high for duplicated read-only code with no bug. Low to medium fits better, and I chose low because nothing is behaving wrongly. The access note is also accurate: the public route needs no login, and the dashboard route requires guild membership but returns the same rows.

**Fix plan.** Verified the duplication is exact: the two API routes share an identical select (discordId, totalXp, level, messageCount, xpMessageCount from userXp, where guildId, order totalXp desc, limit 100) plus resolveDiscordUsers and the displayName ?? discordId / avatarUrl ?? null mapping. The two pages declare an identical LeaderboardEntry and a byte-identical table (thead, medals for rank 0-2, avatar, level, toLocaleString columns), differing only in indentation.

1. Create apps/web/src/lib/leaderboard.ts exporting LeaderboardEntry (type) and getLeaderboardEntries(guildId: string). It holds the existing select, the resolveDiscordUsers call and the map, and returns the array. Use the same db import (@/lib/db) and resolveDiscordUsers (@/lib/discord).
2. Both routes call it. Public route /api/leaderboard/[guildId]: keep the snowflake check, the guilds lookup and its 404, then `NextResponse.json({ guildName: guildRows[0]!.guildName, entries })`. Dashboard route /api/server/[guildId]/leaderboard: keep auth 401, snowflake 404, isGuildMember 403, then `NextResponse.json(entries)` (bare array). Keep the auth and 404 ordering inside each route.
3. Create apps/web/src/components/leaderboard-table.tsx, a client-safe component `LeaderboardTable({ entries })` holding the whole `<div class="bg-dc-bg-secondary ... overflow-hidden"><table>...` block, copied verbatim. Import the LeaderboardEntry type with `import type` from lib/leaderboard, so no server-only code (db) is bundled into the client. If lib/leaderboard.ts imports db at top level, put the type in a separate file (e.g. lib/leaderboard-types.ts) or define it in the component file and import it from there.
4. Both pages delete the interface and table markup. Each keeps its own fetch logic, loading, error, header, empty-state text and footer, and renders `<LeaderboardTable entries={entries} />` in the entries.length > 0 branch. The public page keeps the `Image` import for its header. The dashboard page keeps `Link`.
5. Do not touch the access mismatch (public vs. member-only) and do not merge the endpoints.

Pure move-and-import. Verify with `pnpm --filter web typecheck` and lint (the next lint config may flag the raw <img> either way; keep the same eslint-disable state if one exists, and note there is none in the current files).

**Behaviour to keep the same.** 1. Response shapes must stay different: public returns {guildName, entries}, dashboard returns a bare array. The dashboard page does setEntries(data) with the array, the public page reads data.entries, so the shared helper must return only the array and the route wraps it.
2. Error bodies and codes differ and must stay in the routes: public uses {error: "Guild not found"} with no code, dashboard uses {error, code: "UNAUTHORIZED"/"NOT_FOUND"/"FORBIDDEN"}. Order of checks matters: dashboard does auth, then snowflake, then membership; public does snowflake, then guild lookup. Do not move any of these into the helper.
3. Empty-state text differs ("No XP data yet." vs. the longer sentence), and headers, wrappers, footers, and outer container classes differ (min-h-screen page vs. max-w-2xl dashboard). The empty state, loading, and error branches must stay in the pages. Do not fold them into the table component.
4. Client/server boundary: both pages are "use client", so the component must not import the helper module if that module imports @/lib/db (server-only env). Use `import type`, or a separate types file, to avoid pulling DB/env code into the client bundle.
5. Query semantics: keep the limit 100 and the order by totalXp desc exactly. The sort has no tie-breaker, so tie order is DB-defined. Do not "fix" it, or the output would change. Keep the same fields selected; the response includes xpMessageCount.
6. The Next.js `<img>` (raw img, not next/image) in the table must stay unchanged, including alt="" and the classes. Medal emoji for i<3 and the `bg-dc-bg-tertiary/30` row highlight must be preserved. The key remains entry.discordId. The sort is not re-applied client-side.
7. The helper runs on a per-request basis with no caching. Do not add caching, since that would change freshness. Also keep resolveDiscordUsers' call arguments (the array of discordIds in query order) so any internal caching or batching behaves identically.
8. Note the dashboard page also fires an admin-check fetch to /api/server/{guildId} in the same effect. Leave that untouched.

**Tests.** Existing coverage: no tests exist for apps/web (the git ls-files search for test/spec files under apps/web/src/app returned nothing, and the finding itself says "No tests"). Check whether the repo has a test runner configured in apps/web (package.json); if not, the safest characterization is lightweight.

Add before refactoring (if a runner such as vitest is available, or add it minimally):
1. Route tests for both GET handlers with db and resolveDiscordUsers mocked. Assert: (a) public route returns 404 for a bad snowflake, 404 for a missing guild, and 200 {guildName, entries} otherwise; (b) dashboard route returns 401/404/403 with the code fields, and 200 with a bare array; (c) with a userMap that lacks an id, displayName falls back to the discordId and avatarUrl to null; (d) the query chain is called with limit(100) and ordered desc by totalXp; (e) entries are passed to resolveDiscordUsers in query order. Snapshot the JSON outputs from the current code and run them unchanged against the refactor.
2. A render test of the table markup: use react-dom/server renderToStaticMarkup on each page's current table block (or on the new component against the old output captured as a snapshot). Capture the HTML for a fixture of 5 entries (with and without avatar, a count over 999 for toLocaleString) before extraction, then confirm the new <LeaderboardTable> yields an identical string. Pin the locale in the test, because toLocaleString depends on the environment.
3. If adding a test runner is out of scope, do a manual check instead: run the dev server, save the HTML and JSON of /leaderboard/{id}, /dashboard/server/{id}/leaderboard, and both API endpoints before and after, and diff them. Also run typecheck and lint, and `next build` to confirm that no server-only module leaks into the client bundle.

### D7
**Two Discord user fetchers for the same endpoint plus three hand-written CDN URL builders**

Impact **low** (the finder said medium) · Effort **S** · Category duplication

Locations: `apps/web/src/lib/discord.ts:29`, `apps/web/src/lib/discord.ts:41`, `apps/web/src/lib/discord.ts:62`, `apps/web/src/lib/discord.ts:191`, `apps/web/src/lib/discord.ts:211`

**What the code does.** getDiscordUser (uncached; gif/png at size=128; displayName=global_name) and resolveDiscordUser (10-minute cache; png at size=64; displayName falls back to username) both fetch /users/{id} with their own try/catch. Their output differs in small ways, so a fix to one silently misses the other.

**Verifier's notes.** The finding holds. In apps/web/src/lib/discord.ts, getDiscordUser (line 29) and resolveDiscordUser (line 191) both fetch https://discord.com/api/v10/users/{id} with the bot token, each with its own try/catch. getDiscordUser has no cache, uses gif or png at size=128 and sets displayName to global_name. resolveDiscordUser keeps results for 10 minutes, does not cache a 429, always uses png at size=64 and falls back to username for displayName. There are three hand-written CDN URL builders: lines 41, 62 (guild icon) and 211. Both functions are in use: getDiscordUser in api/auth/route.ts:58, and resolveDiscordUser through resolveDiscordUsers in the two leaderboard routes. I lower the impact to low. Each copy is only about 15 lines, the different output formats are deliberate, and the proposed fix keeps both public wrappers. That leaves only the fetch call, the headers and the URL template shared, so the gain is small and the "fix one, miss the other" risk is minor.

**Fix plan.** All changes are in apps/web/src/lib/discord.ts. Callers need no edits. getDiscordUser is used only in apps/web/src/app/api/auth/route.ts:58. resolveDiscordUsers is used by the two leaderboard routes. getGuildIconUrl is used by api/guilds/route.ts:71.

1. Add a private `discordCdnUrl(kind: "avatars" | "icons", id, hash, { size, animated })`. It returns `https://cdn.discordapp.com/${kind}/${id}/${hash}.${animated && hash.startsWith("a_") ? "gif" : "png"}?size=${size}`.
   - getDiscordUser calls it with `{size:128, animated:true}`.
   - getGuildIconUrl calls it with `{size:128, animated:true}`. Pass the `guildId` argument as the id, as the code does today.
   - resolveDiscordUser calls it with `{size:64, animated:false}`.

2. Add a private `fetchDiscordUserRaw(userId): Promise<{ status: number | null; user: DiscordUser | null }>`.
   - It makes the same `fetch` call with the same URL and Bot Authorization header.
   - On a non-ok response it returns `{status: res.status, user: null}`.
   - On ok it returns `{status: res.status, user: await res.json()}`.
   - It wraps the whole body in try/catch and returns `{status: null, user: null}` on any throw. That covers network errors and `res.json()` failures.

3. Rewrite getDiscordUser. Call the raw fetcher and return null if `user` is null. Otherwise return `{ username, displayName: user.global_name, avatarUrl: user.avatar ? discordCdnUrl("avatars", user.id, user.avatar, {size:128, animated:true}) : null }`.

4. Rewrite resolveDiscordUser. Keep the cache read first.
   - If `status === 429`, or `status === null` (thrown), return null without caching.
   - Else if `user` is null (non-ok, non-429), cache null for the TTL and return null.
   - Else build `{username, displayName: global_name ?? username, avatarUrl: avatar ? discordCdnUrl(..., {size:64, animated:false}) : null}`, cache it and return it.
   - Keep the `status` three-way distinction: thrown, 429 and other non-ok are three different outcomes.

5. Optionally dedupe the `{username, displayName: string, avatarUrl}` type, which is repeated three times, into one alias. Keep it type-only.

**Behaviour to keep the same.** - The proposed fix says "no tests", but the pre-refactor test below costs minutes and is cheap insurance against the "byte-identical" risk.
- getDiscordUser (the /api/auth path) must keep a `gif` extension for `a_` hashes, `size=128`, and `displayName: global_name`, which can be null with no username fallback. The leaderboard path must keep `png` always, `size=64`, and `displayName = global_name ?? username`. Do not unify the defaults. The animated flag must default to a value that preserves each caller, so pass it explicitly everywhere.
- Error semantics differ. getDiscordUser returns null for any non-ok or throw and never caches. resolveDiscordUser returns null without caching on 429 and on a thrown error, but caches null for 10 minutes on any other non-ok status such as 404 or 403. If the raw fetcher collapsed "thrown" into "non-ok", a network blip would be cached for 10 minutes. This is a regression, so the raw fetcher must report status null on a throw.
- `res.json()` failures sit inside the try in both original functions. Keep them inside the shared try. A malformed body on an ok response must be treated as a thrown error: null, not cached, for resolveDiscordUser.
- Cache semantics must not change. The cache lookup stays before the fetch. The key is the userId. Entries are stored only for success and for non-ok, non-429 responses. The TTL is 10 minutes and the module-level Map is unchanged. Cache hits for null data still return null.
- getGuildIconUrl uses `guildId` and not a response id in its URL. If it is routed through discordCdnUrl, keep that distinction. It would be safest to leave it untouched, or to route only its URL building through the helper.
- The avatar URL uses `user.id` from the response body, not the requested `userId`. Keep that.
- Do not add a `User-Agent`, `cache` or `next` fetch options and do not change the headers. Adding Next fetch caching options would change behavior.
- Do not add logging or change what getDiscordUser returns on failure (null).
- The leaderboard dedupes nothing across IDs and the batching in resolveDiscordUsers stays as is.

**Tests.** Existing coverage: none. apps/web has no test files and no test script in package.json (the git ls-files test/spec search found only apps/bot tests, and the grep of apps/web's package.json for a test script or vitest found nothing). The bot tests are irrelevant.

Characterization tests to write before the refactor, as Vitest or `node:test` with a mocked global `fetch` and a mocked `./env` and `./db`. The `./db` mock is needed because discord.ts imports it at module load.

getDiscordUser:
- Ok with an `a_` avatar returns a `.gif?size=128` URL and `displayName` equal to `global_name`.
- Ok with a null `global_name` returns `displayName: null`.
- Ok with a plain avatar returns `.png?size=128`.
- Ok with a null avatar returns `avatarUrl: null`.
- A 404 returns null.
- A 429 returns null.
- A thrown fetch returns null.
- A `json()` rejection returns null.
- The fetch URL and the `Bot` Authorization header are exactly as before.

resolveDiscordUser:
- An `a_` avatar returns a `.png?size=64` URL with no gif.
- A null `global_name` falls back to `username`.
- A second call within the TTL does not call `fetch`. Use fake timers.
- A call after 10 minutes and 1 ms refetches.
- A 429 returns null and is not cached, so the next call fetches again.
- A thrown fetch returns null and is not cached.
- A 404 returns null and is cached, so the next call makes no fetch.
- The avatar URL uses the response `user.id`.

resolveDiscordUsers: omits failed IDs and respects the batch concurrency.

getGuildIconUrl: a gif and a png case, so a shared CDN helper cannot break it.

Run the same suite before and after the refactor. It must pass unchanged. Also run `pnpm --filter web typecheck` and `lint`.

### D8
**Two near-copies of session-token extraction in auth.ts with different fallback rules**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/web/src/lib/auth.ts:42`, `apps/web/src/lib/auth.ts:71`, `apps/web/src/app/api/auth/route.ts:69`

**What the code does.** getDiscordIdFromRequest and getJwtPayloadFromRequest copy the same cookie parsing (45-51, 73-79) and Bearer handling. They differ: with a present-but-invalid cookie, the first falls back to the Authorization header, the second returns null. getDiscordIdFromRequest's only caller is DELETE /api/auth.

**Verifier's notes.** I confirmed this against the code. In apps/web/src/lib/auth.ts, the cookie parsing at lines 45-51 and 73-79 is the same code, and so is the Bearer handling (60-65 and 84-87). The fallback difference is real. When a cookie is present but invalid, getDiscordIdFromRequest falls through to the Authorization header, because it only returns when the payload is valid. getJwtPayloadFromRequest instead returns verifyJwt(sessionToken), which is null for a bad token. A grep found one caller of getDiscordIdFromRequest, at apps/web/src/app/api/auth/route.ts:69, and one of getJwtPayloadFromRequest, getAuthenticatedUser at auth.ts:98. The duplication is small, about 15 lines, so low impact and small effort are right. The proposed fix keeps each function's fallback order, so it does not change behavior.

**Fix plan.** Only edit apps/web/src/lib/auth.ts. Add two private (non-exported) helpers above getDiscordIdFromRequest:
- readCookie(request: Request, name: string): string | undefined. Move the existing parsing verbatim: get header "cookie"; if absent return undefined; else Object.fromEntries(split(";").map(c => { const [key, ...val] = c.trim().split("="); return [key, val.join("=")]; })) and return cookies[name]. Keep this exact parsing (no decodeURIComponent, no trim of the value, last-duplicate-wins via fromEntries). Do not swap in a cookie library.
- readBearer(request: Request): string | null. Return authHeader.slice(7) only if headers.get("Authorization")?.startsWith("Bearer ") is true, else null. Keep the case-sensitive "Bearer " prefix and the exact slice(7), so "Bearer " alone yields an empty string, which verifyJwt rejects.
Then rewrite each function's body to use the helpers, keeping its own control flow:
- getDiscordIdFromRequest: sessionToken = readCookie(...); if (sessionToken) { payload = await verifyJwt(sessionToken); if (payload) return payload.discord_id; } then bearer = readBearer(...); if (bearer !== null) { return (await verifyJwt(bearer))?.discord_id ?? null; } return null. An invalid cookie falls through to the Bearer header.
- getJwtPayloadFromRequest: sessionToken = readCookie(...); if (sessionToken) return verifyJwt(sessionToken); (no fallthrough) then bearer = readBearer(...); if (bearer !== null) return verifyJwt(bearer); return null.
Do not touch apps/web/src/app/api/auth/route.ts. It only calls getDiscordIdFromRequest (DELETE, line 69). Also confirm that no other file in the repo defines COOKIE_NAME-based parsing that should be merged (out of scope here). Optionally add a one-line comment on each function noting the deliberate fallback difference.

**Behaviour to keep the same.** 1. Fallback difference (the main risk). With a present-but-invalid or expired cookie plus a valid Bearer: getDiscordIdFromRequest returns the Bearer user (DELETE /api/auth returns 200), while getJwtPayloadFromRequest returns null, so getAuthenticatedUser is null and protected routes return 401. If one is rewritten in terms of the other, who can authenticate or log out changes.
2. Truthiness checks. An empty cookie value (`dragonbot_session=`) counts as absent: the first function falls through to Bearer, and the second also falls through because `if (sessionToken)` is false. Keep the truthiness check rather than `!== undefined`.
3. Cookie parsing quirks to preserve: values containing "=" are rejoined; a duplicated cookie name takes the last occurrence; there is no URL-decoding; keys are trimmed but values are not trimmed beyond the c.trim() on the whole pair. A cookie header with no "=" gives key=whole string, value "".
4. The Bearer check is case-sensitive and requires the trailing space. "Bearer" without a space is ignored. "Bearer " gives an empty token, and verifyJwt rejects it, so the result is null. In getDiscordIdFromRequest, a Bearer header present but invalid returns null, which is the same outcome as no header.
5. In the first function, a valid cookie returns early. A refactor that fetches the Bearer token eagerly must not verify it or change the order, because verifyJwt is async and its result must not be used when the cookie is valid.
6. Keep readCookie and readBearer unexported. Exporting them widens the auth surface.
7. getDiscordIdFromRequest does not check jwtInvalidBefore. Do not add that check, because it would change logout behavior for revoked sessions.

**Tests.** Existing coverage: none. There are no test files under apps/web (git ls-files shows tests only in apps/bot, and apps/web/package.json has no test script or runner). The finding's "No tests" proposal is therefore risky for an auth path.
Characterization tests to add first, as an optional pre-refactor step that needs approval because it adds a test runner (e.g. vitest) to apps/web. Alternatively use a throwaway script run with tsx and a stub JWT_SECRET env var. They should call the real signJwt/verifyJwt with a test secret and construct Request objects:
- Both functions: valid cookie only; valid Bearer only; neither header; empty cookie value; cookie among several cookies; a value containing "="; duplicate cookie names; "Bearer" without a space; "Bearer " with an empty token; lowercase "bearer".
- Divergence cases: invalid cookie plus valid Bearer gives the Bearer discord_id from getDiscordIdFromRequest, and null from getJwtPayloadFromRequest. Valid cookie plus a different valid Bearer gives the cookie user from both. Valid cookie plus invalid Bearer gives the cookie user from both.
- getJwtPayloadFromRequest is not exported, so test it through getAuthenticatedUser with a mocked ./db (or temporarily export it for a local check only). Assert that iat/exp are passed through.
- Route-level: DELETE /api/auth returns 401 without a valid token, 200 with an invalid cookie plus a valid Bearer, and sets the clearing Set-Cookie.
Run the same tests before and after the refactor and require identical results. Because the change is mechanical and about 20 lines, a manual before/after diff-run of these cases is acceptable if adding a test framework is declined.

### D9
**Discord error helpers duplicated between honeypot-enforcer and honeypot-warning (and inline in moderation.service)**

Impact **low** (the finder said low) · Effort **S** · Category duplication

Locations: `apps/bot/src/lib/honeypot-enforcer.ts:61`, `apps/bot/src/lib/honeypot-enforcer.ts:66`, `apps/bot/src/lib/honeypot-enforcer.ts:445`, `apps/bot/src/lib/honeypot-warning.ts:77`, `apps/bot/src/lib/honeypot-warning.ts:87`, `apps/bot/src/lib/honeypot-warning.ts:163`, `apps/bot/src/services/moderation.service.ts:27`

**What the code does.** hasErrorCode(err, code) and describeError (+cutReason) in the enforcer duplicate hasErrorCode(err, ...codes) and reasonFor (describeError + slice(0,200)) in the warning module; 200 equals the enforcer's MAX_REASON_LENGTH. moderation.service repeats the DiscordAPIError code check inline. The honeypot modules are otherwise cohesive state machines with ~2,800 lines of tests; the outcome/notice text builders (:445-486) are pure and reconcile (~75 lines, 8 exits) is the densest method.

**Verifier's notes.** I confirmed the finding by reading the code. In honeypot-enforcer.ts, lines 61-72 define hasErrorCode(err, code), describeError and cutReason, which slices to MAX_REASON_LENGTH. In honeypot-warning.ts, lines 77-91 define a variadic hasErrorCode(err, ...codes) with a typeof-number guard, and reasonFor, which uses the same message-or-String(err) logic as describeError plus slice(0, 200). The two modules repeat the same logic with trivial signature differences. Line 27 of moderation.service.ts is in a part of the file I did not view. The inline `err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownGuild` check I saw is in the ban-sync catch, near line 26 of the excerpt. The outcome and notice text builders at about lines 445-486 of the enforcer are pure functions, as stated. The duplication is small: roughly 10 lines across two files plus one inline check. That makes it real but low impact and S effort. The proposed shared helper is a superset and would not change behaviour.

**Fix plan.** 1. Add apps/bot/src/utils/discord-errors.ts exporting: (a) hasErrorCode(err: unknown, ...codes: number[]): boolean = err instanceof DiscordAPIError && typeof err.code === "number" && codes.includes(err.code); (b) describeError(err: unknown): string = err instanceof Error && err.message ? err.message : String(err), with no truncation; (c) optionally errorReason(err, max = 200) = describeError(err).slice(0, max). 
2. honeypot-enforcer.ts (lines 61-72): delete local hasErrorCode and describeError, import them. Keep cutReason and MAX_REASON_LENGTH (200) local, because cuts happen at render time in outcomeText (lines 456, 458, 460), deleteFailedText (485) and the lookup-failure path (270). Several describeError results (369-436) are deliberately stored uncut in outcomes and cut only when rendered, so do not move truncation into describeError.
3. honeypot-warning.ts (lines 77-90): delete local hasErrorCode and reasonFor, import hasErrorCode and errorReason (or define reasonFor as a one-line wrapper over describeError plus slice(0,200) so the 7 call sites at 216, 277, 309, 374, 449 do not change). Optionally import MAX_REASON_LENGTH from one place so the 200 is not repeated.
4. moderation.service.ts:27: replace the inline `err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownGuild` with hasErrorCode(err, RESTJSONErrorCodes.UnknownGuild), and remove the DiscordAPIError import if it is unused. This one is optional and the lowest value.
5. Skip the optional extras (the honeypot-texts.ts extraction and the verifyStoredWarning split of reconcile at :206-232). They are separate, riskier refactors with little payoff, and should be separate findings or PRs. If you do them, move the pure functions verbatim and keep the exports private to lib. Run pnpm --filter bot test and typecheck/lint after each step.

**Behaviour to keep the same.** - The typeof-number guard: the enforcer's version has none. DiscordAPIError.code is typed number | string, so a string code could never equal a numeric code anyway, and the superset form gives the same result for every numeric RESTJSONErrorCodes constant. - Truncation placement: the warning module cuts to 200 at the point of description. The enforcer keeps full reasons in Outcome objects and cuts only when rendering notices. Pushing the cut into a shared describeError would change what the enforcer logs or stores (anything that reads outcome.reason uncut, such as ctx.logger fields). Keep the cut at callers. - The 200 limit must stay identical in both modules, or notice text lengths change. Tests that assert notice text with long messages would catch a mismatch. - describeError must keep the `err instanceof Error && err.message ? ... : String(err)` branch, so an Error with an empty message yields "Error", and non-Error throws yield String(x). - The enforcer's status 400-499 check at line 367 (err.status) is a different check, not a code check. Do not fold it into hasErrorCode. - Import in tests: the tests use real DiscordAPIError and do not vi.mock discord.js, so a new shared module needs no mock changes. Watch for circular imports (utils must not import from lib). - moderation.service: its catch must still fall through to the warn log for non-UnknownGuild errors, and a DiscordAPIError with a different code must not disable ban sync.

**Tests.** Existing coverage: apps/bot/tests/lib/honeypot-enforcer.test.ts and apps/bot/tests/lib/honeypot-warning.test.ts (both build real DiscordAPIError via an apiError helper, so they exercise the code checks: UnknownMember, UnknownBan, UnknownMessage, MissingPermissions, max pins, UnknownGuild) and apps/bot/tests/services/moderation.service.test.ts (lines 36-56 cover UnknownGuild disabling ban sync and the non-disabling case). The audit's claim that honeypot tests cover this holds. Add before refactoring, as characterization: (1) a new tests/utils/discord-errors.test.ts covering hasErrorCode with a DiscordAPIError with a matching code, a non-matching code, multiple codes, a plain Error with a numeric `code` property, a non-Error value, and a string code; describeError with an Error with a message, an Error with an empty message, a string, an object, and null; errorReason with a message over 200 characters, one exactly 200 and one shorter. (2) If missing, an enforcer test where a failed-removal reason over 200 characters appears truncated to 200 in the notice text but whole in any log call; and a warning-sync test where a >200 character error message is truncated to 200 in the notice (check by grep whether these exist before adding). (3) A warning test for a non-Error throw (e.g. a string rejection) producing the String(err) text. Then run the full bot test suite plus typecheck.

### P11
**Birthday queries: same per-date query runs once per guild, /next-birthdays loads every birthday, no index on birthday columns**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `apps/bot/src/lib/birthday-checker.ts:123`, `apps/bot/src/repositories/birthday.repository.ts:50`, `apps/bot/src/repositories/birthday.repository.ts:68`, `apps/bot/src/services/birthday.service.ts:58`, `apps/bot/src/commands/next-birthdays.ts:34`, `packages/db/src/schema.ts:39`

**What the code does.** BirthdayChecker.check calls getTodaysBirthdays(month, day) inside the per-guild loop with identical arguments, each a sequential scan of users (no index on birth_month/birth_day; schema.ts:39-41). /next-birthdays loads every birthday row (unbounded getAllBirthdays) and filters in memory after a full guild members.fetch(). Low frequency.

**Verifier's notes.** The finding holds. check() loops over the guilds at birthday-checker.ts:29 and calls announceForGuild at :68. announceForGuild calls getTodaysBirthdays(month, day) at :123 with the same arguments for every guild, and there is no memo. getBirthdaysByDate filters users on birth_month and birth_day. schema.ts lines 39-41 put no index on those columns, and the only indexes in the file are on other tables. getAllBirthdays has no limit. getUpcomingBirthdays loads every birthday and filters it in memory. /next-birthdays runs a full guild members.fetch() first. All of this is low-frequency work: the check runs once a day from an external trigger and is deduplicated per guild per day, and the command runs only when someone calls it. The users table is probably small, so low impact is right.

**Fix plan.** Scope: only the in-run memo in apps/bot/src/lib/birthday-checker.ts. I verified the call path. check() loops guilds. For each guild it computes (month, day) in the guild's timezone and calls announceForGuild(guildId, channelId, roleId, msg, month, day, log). That method calls birthdayService.getTodaysBirthdays(month, day) at line 123, which calls repo.getBirthdaysByDate. The query is a seq scan of users filtered on birth_month and birth_day. It is identical for guilds that share a date.

Steps:
1. In check(), create `const birthdayCache = new Map<string, Promise<BirthdayRow[]>>()`. Pass it as a new OPTIONAL last parameter of announceForGuild, e.g. `birthdayCache?: Map<...>`. Do not change the first seven parameters. tests/lib/birthday-checker.test.ts calls the private method with exactly 7 positional args via checker["announceForGuild"], and that call must keep working.
2. Inside announceForGuild, replace line 123 with a small helper. The helper looks up key `${month}-${day}`. On a miss it stores the promise returned by getTodaysBirthdays(month, day). It then awaits that promise. When no cache is passed, it calls the service directly, which is the current behaviour.
3. Cache the promise, not the resolved value. If the query rejects, the rejection lands in the same try/catch in announceForGuild. Each guild that shares the key then logs 'Failed to announce birthdays for guild' exactly as it does today. check() still persists lastBirthdayCheckDate afterwards, as it does today. A failed query is therefore not retried for a second guild on the same date within the run. Today a second guild would re-query and might succeed. That is the only observable difference. To stay strictly identical, delete the map entry in a .catch so a failure is retried per guild.
4. Do not put the memo on the BirthdayService instance or in a long-lived field. It must be scoped to one check() run, because check() runs every 4 hours and must see newly registered birthdays.
5. Out of scope for this S fix, each needing separate approval. (a) Partial index users(birth_month, birth_day) WHERE birth_month IS NOT NULL. packages/db has no tracked migrations directory; only drizzle.config.ts is tracked, so the schema is applied by drizzle-kit push or generate. It adds an index definition at schema.ts near line 39, and the users table currently has no index() block. That is a schema change on a production table and has to follow the repo's deploy process, so treat it as its own item. It does not change results. (b) /next-birthdays. getUpcomingBirthdays(memberIds, count) filters getAllBirthdays() in memory by the member set after a full members.fetch(). A SQL-side fix (WHERE discord_id = ANY(memberIds)) would send up to guild-size ids and is not clearly a win. The repo's own evidence rates it low frequency, so recommend no change.
Files touched: apps/bot/src/lib/birthday-checker.ts and apps/bot/tests/lib/birthday-checker.test.ts.

**Behaviour to keep the same.** 1. Rejection sharing. If the query fails, a cached rejected promise would make every later guild on that date fail without retrying. Today each guild retries. Evict on rejection to keep parity (see plan step 3).
2. Key must be (month, day) as computed per guild timezone. Guilds in different timezones can be on different dates in the same run, and a key of only 'today' would be wrong. Do not key on the guild or on a global 'now'.
3. Shared array mutation. Callers must not mutate the returned array. announceForGuild only maps and iterates it, so it is safe. Do not cache a mutated structure.
4. Staleness. Within one check() run, a birthday set or removed between guild 1 and guild 2 is now not seen by guild 2. This is a window of seconds to minutes and is negligible, but it is a real difference.
5. Early returns precede the use of the result. When birthdayUsers is empty the method returns before the guild-cache check and the member fetch. Keep that order and the 'return' semantics so the logs and calls are unchanged.
6. Keep the existing ordering of side effects: removeYesterdayRoles, then announce, then updateSettings. Hoisting the query out of the loop (instead of using a lazy memo) would change when errors surface and would query for guilds that are skipped before 9 AM or already checked. Use a lazy memo, not an eager pre-query.
7. The private method signature has to remain call-compatible with the existing test (7 args).
8. Index: it changes only query plans, not results. It adds write overhead on users updates, which is trivial. The migration and deploy process is the real risk.

**Tests.** Existing coverage: apps/bot/tests/lib/birthday-checker.test.ts covers only announceForGuild. It has two tests: no announcement in another server's channel, and announcement in the same server's channel. It does not cover check(), the timezone and 9 AM gating, the dedup key, getTodaysBirthdays call counts, or error handling. Nothing covers BirthdayService or BirthdayRepository (getBirthdaysByDate, getAllBirthdays, getUpcomingBirthdays) or the /next-birthdays command.

Characterization tests to add BEFORE the change (they must pass on the current code):
1. check() with two enabled guilds and the same timezone, using vi.useFakeTimers to pin the time past 9 AM. Assert that announce is reached for both and that updateSettings is called for each with the same checkKey. Currently getTodaysBirthdays is called twice with identical (month, day). Record that, then flip the assertion to toHaveBeenCalledTimes(1) as part of the fix.
2. check() with two guilds in different timezones, where the local dates differ (for example Pacific/Kiritimati vs Pacific/Pago_Pago). Assert that getTodaysBirthdays is called once per distinct (month, day), with the right arguments each time.
3. getTodaysBirthdays rejects. Assert that log.error 'Failed to announce birthdays for guild' is emitted and that updateSettings is still called for that guild (current behaviour). Then add a case where the first call rejects and the second succeeds for another guild on the same date. Assert the retry behaviour that the chosen eviction strategy implies.
4. A guild before 9 AM or with a matching lastBirthdayCheckDate must produce zero getTodaysBirthdays calls (this guards against eager hoisting).
5. announceForGuild called with 7 args still works (the existing two tests already guard this).
6. Optionally, service and repository unit tests (mocked db or an integration test) for getUpcomingBirthdays: the year-rollover case, today's birthday giving daysUntil 0, and the 15 count limit. This is only needed if the /next-birthdays change is ever taken up. Not needed for the memo fix.
If the index is approved, no unit test is needed. Verify with EXPLAIN on a staging DB and check that the migration is idempotent.

### P13
**PATCH /api/server/{id} reads the same guild row twice; sensitive-field strip code copied in GET/PATCH**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `apps/web/src/app/api/server/[guildId]/route.ts:101`, `apps/web/src/app/api/server/[guildId]/route.ts:118`, `apps/web/src/app/api/server/[guildId]/route.ts:143`, `apps/web/src/app/api/profile/route.ts:22`, `apps/web/src/app/api/profile/route.ts:51`

**What the code does.** When a PATCH touches both xpMin/xpMax and a honeypot/channel field, the route selects xpMin/xpMax then separately select * for the honeypot conflict check: two Neon HTTP round trips for one key. The profile route's sensitive-field destructuring and the guild route's id strip are each copied in GET and PATCH.

**Verifier's notes.** I confirmed every part of the claim in the code. In apps/web/src/app/api/server/[guildId]/route.ts, line 101 selects xpMin and xpMax when the body sends either field. Line 118 then runs a separate `select *` for the same guildId when the body sends honeypotChannelId or any HONEYPOT_CONFLICT_FIELDS key. A PATCH that touches both groups therefore makes two database round trips for the same row. The `id` strip is copied at line 38 (GET) and line 143 (PATCH). In apps/web/src/app/api/profile/route.ts, the six-field sensitive destructure is copied word for word at lines 22 and 51. The profile copy is the part that matters for maintenance: a new sensitive column has to be added in both places, or one handler leaks it. The behaviour risks the finding lists are accurate: the xp error comes before the honeypot error, and a missing row skips both checks and returns 404 from the update. The impact is still low. This is a dashboard settings write path, not a hot path, and the extra round trip only happens when one request carries both field groups.

**Fix plan.** Files: apps/web/src/app/api/server/[guildId]/route.ts (PATCH), plus optional apps/web/src/app/api/profile/route.ts and one new helper module (e.g. apps/web/src/lib/safe-rows.ts). Behavior-preserving fixes exist for both halves, but the DB-read half is NOT a simple win and should be scoped carefully.

(1) Double read. Current flow: if xpMin/xpMax in body -> SELECT xpMin,xpMax (line 101); if any honeypot/channel field in body -> SELECT * (line 118). Only the overlap case (body has an xp field AND a honeypot/channel field) does two reads. Fix: add a lazy loader in PATCH, e.g. `let existingRow: GuildRow | undefined | null = null; const loadExisting = async () => { if (existingRow === null) existingRow = (await db.select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1))[0]; return existingRow; };` (use a separate `loaded` boolean so an undefined result, meaning row missing, is cached and not re-fetched). The xp block calls `const existing = await loadExisting()` and keeps the same logic (`if (existing) {...}`), staying first. The honeypot block calls `loadExisting()` and keeps `if (existing) { findHoneypotChannelConflict({ ...existing, ...parsed.data }) }`. Net: xp-only PATCH now does SELECT * instead of SELECT xpMin,xpMax (slightly more egress, one round trip either way); honeypot-only unchanged; overlap case drops from 2 reads to 1. If egress on xp-only PATCH matters, alternative is to keep the narrow select and only reuse when overlap, but that needs knowing up front: compute `needsHoneypot` before the xp block and, when both are needed, load the full row once; otherwise keep narrow xp select. That variant is strictly never worse and is the recommended one.
Real-world impact is tiny (admin settings save, low frequency), so this could reasonably be dropped; there is also a TOCTOU nuance, see risks.

(2) Strip duplication. Add `toSafeGuild(row)` returning `const { id: _id, ...rest } = row; return rest;` and `toSafeUser(row)` destructuring the six sensitive fields (id, email, jwtInvalidBefore, banGuildId, bannedAt, isBanned). Replace the 4 inline destructures (guild route lines 38 and 143, profile route lines 22 and 51). Type with the Drizzle `$inferSelect` types so the return type stays identical to today (Omit<Row, ...>). Prefer a denylist helper exactly as now; do NOT switch to an allowlist, which would change output when columns are added. Consider that the helper is a security-relevant chokepoint, so it is a real improvement: a new sensitive column then needs one edit, not four.

Effort stays S (about 30-45 min including tests), contrary to the finding's 'No tests'; add tests first.

**Behaviour to keep the same.** 1. Validation order: xp error (400 'xpMin cannot be greater than xpMax') must be returned before the honeypot conflict error; with a shared row, evaluate xp first and only then the honeypot check. A body that violates both must still yield the xp message.
2. Row missing: both checks currently skip when the row is absent (`if (existing[0])`), then the UPDATE returns 0 rows -> 404 'Server not found'. The lazy cache must distinguish 'not loaded yet' from 'loaded, row missing' (use a loaded flag, not `=== undefined`), otherwise a missing row triggers a second query or a thrown TypeError on spread. Missing row must never produce 400.
3. Conflict check input: `{ ...existing, ...parsed.data }` must use the full row (SELECT *), not the narrow xp row, or findHoneypotChannelConflict sees undefined stored channels and misses conflicts. If the narrow xp select is replaced by SELECT *, xp logic uses existing.xpMin/xpMax, which is the same data.
4. xp semantics: `parsed.data.xpMin ?? existing.xpMin` — null in body is not allowed by the schema presumably, but keep `??` exactly, not `||`.
5. Trigger conditions: honeypot check keys off `field in parsed.data` (presence, including explicit null clears), xp check off `!== undefined`. Do not unify these predicates. Keep `honeypotChannelFields` computed from HONEYPOT_CONFLICT_FIELDS.
6. Never read the row before the permission/scope checks (403 must precede any DB read and the validation 400); keep the lazy loader below them. Also keep the body-parse/validation order unchanged.
7. Concurrency: both checks read before the UPDATE with no transaction; sharing one snapshot does not make this worse (reads were already non-atomic with the write), and actually makes the two checks consistent with each other. Do not 'fix' this into a transaction here; that would change behavior.
8. Response shape: toSafeGuild/toSafeUser must return the same keys, including Date objects serialized identically by NextResponse.json; keep the denylist, do not allowlist. The unused-variable underscore bindings (_id, _id2) disappear; check eslint no-unused-vars config does not need adjustment in the helper (keep underscore naming).
9. notifyBotReload still called after successful update and before the response, and not on 404. Error handling: neither route has try/catch today; a thrown DB error still propagates to a 500 identically, but with the shared loader a failure in the xp read now surfaces at the same point, fine.
10. Profile PATCH returns rows[0] stripped; GET and PATCH 404 messages differ ('Profile not found' vs 'Server not found'); leave untouched.

**Tests.** Existing coverage: none for apps/web. git ls-files shows tests only under apps/bot/tests (honeypot.test.ts, honeypot-enforcer, etc.) and a design spec; there are no route tests in apps/web, so these routes are untested. The pure function findHoneypotChannelConflict in packages/db is likely covered indirectly by apps/bot/tests/db/honeypot.test.ts; verify before relying on it.

Characterization tests to add BEFORE refactoring (vitest, mocking '@/lib/db', '@/lib/auth', '@/lib/discord', '@/lib/bot-webhook'; db mock counts select calls and returns canned rows):
a) PATCH xpMin > stored xpMax -> 400 with 'xpMin cannot be greater than xpMax'; xpMax only below stored xpMin -> 400; valid -> 200.
b) PATCH honeypotChannelId equal to a stored logging channel -> 400 with the 'honeypot channel can't be the same as the X channel' message; body clearing a conflicting channel with null -> 200; setting channel to a value conflicting with another field in the same body -> 400.
c) Overlap case: body with xpMin>xpMax AND a honeypot conflict -> expects the xp message (order). Body with valid xp and conflicting honeypot -> honeypot message. Assert select call count (currently 2; after fix 1) to document the intended change.
d) Row missing: select returns [] for both checks, update returns [] -> 404 'Server not found', not 400; assert update still called and notifyBotReload not called.
e) Permission: missing scope -> 403 and zero db selects/updates; no permissions -> 403 before body parse.
f) Response shape: GET and PATCH for guild omit `id` but retain every other key; profile GET and PATCH omit id, email, jwtInvalidBefore, banGuildId, bannedAt, isBanned and keep the rest (snapshot of keys using a fixture row with all columns). These also serve as unit tests for toSafeGuild/toSafeUser (assert keys via Object.keys equality against the pre-refactor snapshot).
g) notifyBotReload called exactly once with guildId on success.
Run suite green on current code, then refactor, then rerun unchanged except the select-count assertion in (c). Note apps/web may need a test runner/config added (check apps/web/package.json); if none exists, adding vitest config is extra setup that raises effort toward the upper end of S, or the tests could live in a small pure helper test for toSafe* only with the route covered manually.

### P14
**Index gaps and a redundant index versus queried columns**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `packages/db/src/schema.ts:151`, `packages/db/src/schema.ts:163`, `packages/db/src/schema.ts:166`, `packages/db/src/schema.ts:194`, `packages/db/src/schema.ts:200`, `apps/web/src/app/api/guilds/route.ts:32`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:49`, `apps/web/src/app/api/server/[guildId]/schedules/route.ts:44`, `apps/bot/src/repositories/scheduled-message.repository.ts:21`, `apps/web/src/app/api/auth/route.ts:40`, `apps/web/src/app/api/server/[guildId]/suggestions/route.ts:29`

**What the code does.** guild_admins has only unique(guild_id, discord_id) but is queried by discord_id alone on every dashboard load. scheduled_messages has no index although filtered by guild_id and is_enabled. auth_tokens.token is .unique() and also has auth_tokens_token_idx (duplicate index, extra write cost). expires_at has no index yet every login runs DELETE WHERE expires_at < now(). Suggestions GET is unbounded and sorts by created_at with only a guild_id index. Tables are small today.

**Verifier's notes.** I confirmed every factual claim against the code. In packages/db/src/schema.ts, guild_admins has only the composite unique(guild_id, discord_id) at line 163. Because guild_id is the leading column, that index cannot serve the discord_id-only lookups in api/guilds/route.ts:32 and discord/route.ts:49. scheduled_messages (lines 166-182) has no index, yet it is filtered by guild_id in the schedules route and in findAllByGuild, and by is_enabled in findAllEnabled. auth_tokens.token is .unique() at line 194 and also has index auth_tokens_token_idx at line 200, so the token column carries two indexes. expires_at has no index, while auth/route.ts runs DELETE WHERE expires_at < now() after each token exchange. That delete is fire-and-forget, so it costs the database work but adds no request latency. The suggestions GET filters by guild_id and orders by created_at desc with no LIMIT, and only suggestions_guild_idx exists. The finding already says these tables are small (one row per admin, schedule or token), so the practical impact is negligible, and LOW is the right rating. The proposed indexes do not change query results. Side note outside this finding: discord/route.ts:49 applies .limit(1) to the discord_id-only query before checking guildId. A custom admin of several guilds can therefore be wrongly denied the custom-admin shortcut, though the code then falls back to the Discord permission check. That is a correctness issue, not a performance one.

**Fix plan.** Behavior-preserving fix exists, and it is pure schema DDL with no query changes. Verified in code: guild_admins is queried by discord_id alone (no matching index; the unique is (guild_id, discord_id), so leading column is guild_id); scheduled_messages.findAllByGuild filters guild_id and orders by created_at (no index); findAllEnabled filters is_enabled (boolean, low selectivity, an index is not worthwhile, so skip it); auth_tokens cleanup is DELETE WHERE expires_at < now() (fire-and-forget in apps/web/src/app/api/auth/route.ts); suggestions GET filters guild_id and orders by created_at DESC, unbounded. Steps, all in /packages/db/src/schema.ts (single file):
1. guildAdmins table: add index("guild_admins_discord_idx").on(table.discordId) to the existing extras array. Do not touch the unique.
2. scheduledMessages: add a second-arg callback, (table) => [index("scheduled_messages_guild_idx").on(table.guildId)]. Optionally (guildId, createdAt) to cover the ORDER BY; prefer plain guild_id to match the finding and repo convention.
3. authTokens: replace the extras array content: remove index("auth_tokens_token_idx").on(table.token) (the .unique() constraint already creates a unique btree on token, so lookups are served identically); add index("auth_tokens_expires_idx").on(table.expiresAt). Net writes per insert stay the same (one index swapped for another) but the redundant one is gone.
4. suggestions: change index("suggestions_guild_idx").on(table.guildId) to a composite index("suggestions_guild_created_idx").on(table.guildId, table.createdAt.desc()) (or plain (guildId, createdAt); Postgres scans btrees backward so desc is optional). Keep or drop the old single-column index: the composite's leading column makes it redundant, so drop it, but only after the new one exists.
5. Rollout: the repo has no migration files (drizzle.config.ts out ./drizzle does not exist; workflow is `pnpm --filter @dragonbot/db db:push`). Run db:push against Neon after reviewing the diff drizzle-kit prints. Note db:push issues plain CREATE INDEX (not CONCURRENTLY), taking a brief write lock; tables are small so this is fine. If any table is large, create the indexes manually with CREATE INDEX CONCURRENTLY IF NOT EXISTS first, then run db:push (it will see them as already present only if names match exactly, so use the exact names above). Index additions are safe to ship before or after code since no code references them; no ordering constraint with deploys, unlike new columns (AGENT.md line 304 concern does not apply).
6. Requires Kevin's approval before any db:push, per audit rules. Do not add LIMIT to suggestions.

**Behaviour to keep the same.** - Indexes cannot change result sets. One subtlety: ordering ties. Suggestions and scheduled messages ORDER BY created_at with no tiebreaker; a new index could change the physical order of rows with identical created_at timestamps (planner may choose index scan instead of sort). Timestamps are defaultNow() with microsecond resolution and ties are effectively impossible except bulk inserts within one transaction (same now()), so risk is negligible but nonzero; to eliminate it, no code change is needed but be aware tie order was already unspecified.
- Dropping auth_tokens_token_idx: the unique constraint auth_tokens_token_unique remains and backs the same lookups and ON CONFLICT behavior. Confirm the unique constraint actually exists in the live Neon DB before dropping (verify with \d auth_tokens); if the live DB was created some other way and lacks it, dropping the index would remove the only index and the uniqueness guarantee.
- drizzle-kit push may prompt interactively or propose unrelated drift (e.g., renames, pending column changes on guilds from the honeypot branch). Review the printed statements; abort if anything other than the five index operations appears.
- Drop of suggestions_guild_idx and creation of the composite are in the same push; push runs statements in order but if interrupted you could briefly have neither; harmless.
- Write cost: each added index slightly slows inserts/updates on those tables (guild_admins, scheduled_messages, auth_tokens, suggestions); auth_tokens is net neutral, the others add one index each. Negligible at current volume.
- expires_at index only helps if the table accumulates many rows; with cleanup on each login it stays small, so benefit is marginal; the planner will likely seq-scan small tables regardless. Low impact is accurate; this item is optional hygiene.
- No functional, error-message, logging, caching, or ephemeral-flag behavior is touched.

**Tests.** Existing coverage: none directly. apps/bot/tests (suggest.test.ts, scheduler.test.ts, and others) mock the db layer, and there are no web tests or schema/integration tests in the repo, so nothing exercises indexes or real Postgres. Existing tests will remain unaffected since no TypeScript query code changes; run `pnpm -r typecheck` (or turbo build) and the bot vitest suite to confirm schema.ts still compiles and exports unchanged.
Characterization checks to run before and after (manual or scripted against a dev/Neon branch, not unit tests): (1) capture the result rows and order of the five queries (guild_admins by discord_id, scheduled_messages by guild ordered by created_at, scheduled_messages enabled, suggestions by guild ordered desc, auth_tokens token lookup) on a branch copy of production data, apply db:push, and diff outputs; (2) EXPLAIN the same queries before/after to confirm the new indexes are actually used (and that the token lookup still uses the unique index); (3) run `drizzle-kit push --verbose` (or generate to a scratch dir) and confirm the diff contains only the expected CREATE INDEX / DROP INDEX statements; (4) verify uniqueness still enforced: inserting a duplicate auth token fails with a unique violation. Using a Neon branch (neon-postgres-branches skill) is a good safe place to rehearse. Optional: add a small schema test asserting the index names exist via getTableConfig from drizzle-orm/pg-core, to guard against accidental removal of the unique on auth_tokens.token.

### P15
**/discord route sorts with raw.find inside the comparator (quadratic)**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `apps/web/src/app/api/server/[guildId]/discord/route.ts:84`, `apps/web/src/app/api/server/[guildId]/discord/route.ts:99`

**What the code does.** Each comparison does two linear raw.find scans, so sorting is O(n^2 log n) on every settings, schedules or YouTube page load.

**Verifier's notes.** The finding holds. In apps/web/src/app/api/server/[guildId]/discord/route.ts, the channel sort comparator (lines 84-88) and the role sort comparator (lines 99-103) each call raw.find twice. Each comparison is therefore O(n), and each sort is O(n^2 log n). Nothing caches or memoizes the position lookup.

The practical cost is small. Discord limits a guild to 500 channels and 250 roles, so the worst case is a few million cheap comparisons, a few milliseconds of CPU. The two Discord API fetches on the same request take far longer. Low impact and effort S are both right.

The proposed fix keeps behaviour unchanged: build a Map of id to position once, keep the `?? 0` fallback, and keep roles in descending order. The sort is stable and the comparator values do not change, so the output order stays the same. A simpler option also works: channels and roles are built in the same order as raw (roles minus @everyone), so the code could sort raw by position before mapping.

**Fix plan.** Single file: apps/web/src/app/api/server/[guildId]/discord/route.ts. Channels block (lines 83-88): before sorting, build `const channelPos = new Map<string, number>(); for (const r of raw) if (!channelPos.has(r.id)) channelPos.set(r.id, r.position ?? 0);` (first-wins mirrors Array.find), then `channels.sort((a, b) => (channelPos.get(a.id) ?? 0) - (channelPos.get(b.id) ?? 0));`. Roles block (lines 99-103): same pattern with `rolePos`, comparator `(rolePos.get(b.id) ?? 0) - (rolePos.get(a.id) ?? 0)` (keep descending, higher position first). Leave the `@everyone` skip, color formatting and response shape untouched. An equivalent alternative is to push `position` into a local array of objects and sort that, then strip it, but the Map is the smaller diff. Note the real-world gain is tiny: Discord guilds cap at 500 channels and 250 roles, and the route is dominated by two network fetches plus the DB/permission check, so this is a tidy-up rather than a measurable win. Optionally fix the stale comment 'Sort by position, filter out categories' (no filtering happens) only if the user approves a comment change.

**Behaviour to keep the same.** 1) Duplicate ids in raw: find() returns the first match, so the Map must keep the first entry (use has() guard, do not overwrite). Discord ids are unique so this is theoretical, but the guard keeps it exact. 2) Keep `?? 0` at lookup and/or set time so missing/null position still counts as 0; do not drop it or switch to `|| 0` (same for 0 but differs for NaN). 3) Preserve direction: channels ascending (a - b), roles descending (b - a). 4) Stability: Array.prototype.sort is stable (ES2019, Node 12+), so ties (many channels share position 0 across categories, and equal role positions) keep original insertion order, which is raw order minus skipped @everyone; the filter order is unchanged by the fix. 5) Do not sort `raw` itself or mutate it. 6) Categories are still included in the channels output (the comment is misleading); do not 'fix' that, as the UI may rely on it. 7) Comparator sign/NaN semantics identical as long as lookups return numbers. 8) Error handling (try/catch returning 500 with no code) and the res.ok skip-silently behavior must stay as is.

**Tests.** No existing tests cover it: the only tests in the repo are under apps/bot/tests; apps/web has none, and nothing there references this route besides three client fetches (dashboard server page, schedules page, youtube page). Before refactoring, add a characterization test for the GET handler (vitest, if web gets a test runner added; otherwise a standalone script or the bot's vitest config) mocking `@/lib/auth` getAuthenticatedUser, `@/lib/discord` checkGuildPermission, `@/lib/db`, `@/lib/env`, and global fetch. Cases: (a) channels with shuffled positions return ascending by position; (b) channels with tied positions keep raw order (stability); (c) channel type mapping text/voice/category/announcement/forum/other and categories retained; (d) roles return descending by position with @everyone excluded; (e) role with color 0 gives #b5bac1 and others zero-padded hex; (f) tied role positions keep raw order; (g) missing/undefined position treated as 0; (h) duplicate id in raw uses the first entry's position; (i) channelsRes.ok false gives empty channels while roles still return, and vice versa; (j) fetch throwing gives 500 with the 'Failed to fetch Discord data' body; (k) 401, 404 for bad snowflake, and 403 paths. Record outputs against the current implementation first, then apply the fix and confirm identical results. Optionally add a randomized equivalence test comparing old vs new comparator on a few thousand generated inputs including ties and duplicates.

### P16
**Every dashboard save triggers a full cross-guild scheduler.reload() on the bot**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `apps/web/src/lib/bot-webhook.ts:7`, `apps/web/src/app/api/server/[guildId]/route.ts:141`, `apps/bot/src/lib/webhook-server.ts:71`, `apps/bot/src/repositories/scheduled-message.repository.ts:25`

**What the code does.** notifyBotReload fires on every settings PATCH and every YouTube/schedule change; the bot webhook always calls scheduler.reload(), which selects all enabled schedules across all guilds even when only e.g. the welcome message changed. Reload is diff-based, so the cost is one unbounded select per save. scheduler.test.ts covers diffing, not the webhook.

**Verifier's notes.** I confirmed the finding from the code. In apps/web/src/lib/bot-webhook.ts:7, notifyBotReload(guildId) sends only a guildId and no scope. It is called from the settings PATCH at apps/web/src/app/api/server/[guildId]/route.ts:141, from the schedule routes and from the YouTube routes. The bot's webhook handler in apps/bot/src/lib/webhook-server.ts always calls getScheduler().reload(), whatever changed. That reload (scheduler.ts:41) calls getAllEnabled(), which runs ScheduledMessageRepository.findAllEnabled(): a select of every enabled schedule across all guilds, with no guild filter and no limit. It then diffs against the in-memory jobs and only rebuilds jobs that changed, so the extra cost per save is one unbounded select plus an in-memory diff. Saves happen only when someone edits in the dashboard, the call is fire-and-forget so it never slows the web response, and the table is small (a few schedules per guild). So the claim is accurate, but the impact is low.

**Fix plan.** Behavior-preserving fix exists, but the gain is tiny (one indexed-or-small select on scheduled_messages per dashboard save), so it is optional and the lowest-priority item.

Verified facts: the settings PATCH (apps/web/src/app/api/server/[guildId]/route.ts:141) calls notifyBotReload(guildId) after updating only the `guilds` row. The webhook (apps/bot/src/lib/webhook-server.ts ~L71-75) always runs `scheduler.reload()` after the guild invalidate/getSettings. reload() calls service.getAllEnabled() -> repository.findAllEnabled(), an unbounded select where isEnabled = true across all guilds, then diffs by id/cron/timezone/updatedAt. Schedules and YouTube routes (schedules/route.ts:88, schedules/[scheduleId]/route.ts:63,96, youtube/route.ts:87, youtube/[subscriptionId]/route.ts:59,92) call the same function.

Steps:
1. apps/web/src/lib/bot-webhook.ts: change signature to notifyBotReload(guildId: string, scope?: "settings"). Append `&scope=settings` only when scope === "settings"; otherwise the URL is byte-identical to today. Do not add the other enum values (schedules/youtube): they add no benefit, since all non-settings callers must keep the full reload.
2. apps/web/src/app/api/server/[guildId]/route.ts:141: pass "settings". Leave the five other call sites untouched.
3. apps/bot/src/lib/webhook-server.ts: read `url.searchParams.get("scope")`. Skip scheduler.reload() only when scope === "settings" exactly; any other or missing value (including unknown strings) falls through to the existing reload. Keep the guild invalidate/getSettings/hydrateAll branch, the onGuildReload honeypot sync and the 200 response unchanged. Never reject an unknown scope with 400, since that would change behavior for old/new version skew.
4. Update the AGENT.md webhook section (document the optional scope param) when the doc update is approved.

Prerequisite check before shipping: confirm the settings PATCH body (parsed.data zod schema) contains no field the scheduler consumes. Scheduler rows carry their own timezone/channel/message, and I saw no dependency of the scheduler on guild settings, but verify against the schema once.

**Behaviour to keep the same.** 1. Opportunistic sync loss: today any settings save also repairs a schedule/YouTube change whose own notification failed (fire-and-forget, errors swallowed), so the schedule drifts only until the next save of any kind. With scope=settings that incidental repair disappears and the drift lasts until the 4-hour sync (or the next schedule save). This is a small, real behavior change in failure-recovery only; the normal path is unchanged.
2. Scope must default to full reload: missing, empty, or unrecognized scope must still call scheduler.reload(). Old web + new bot and new web + old bot (old bot ignores the param and does a full reload, which is safe) must both work.
3. Do not touch the honeypot onGuildReload call, the cache invalidate + getSettings ordering, the 500 error path/log message, or the guildId SNOWFLAKE validation (still validated before scope handling).
4. The log line "Schedules synced" from reload() will no longer appear on settings saves, which is observable in logs only.
5. URL building: keep encodeURIComponent for guildId and no change to the Authorization header; auth check happens before scope parsing, so it is unaffected.
6. reload() is global (not per guild), so skipping it cannot affect other guilds' state beyond item 1.

**Tests.** Existing coverage: apps/bot/tests/lib/scheduler.test.ts covers reload diffing only. There is no test for webhook-server.ts or bot-webhook.ts (git ls-files shows none), so the webhook route is currently uncovered.

Add characterization tests BEFORE changing code (they must pass against current code):
- apps/bot/tests/lib/webhook-server.test.ts (start the server on an ephemeral port with mocked guildService, scheduler and onGuildReload): (a) 401 without/with wrong bearer; (b) POST /webhook/reload?guildId=<valid> invalidates the cache, calls getSettings, calls scheduler.reload() once, calls onGuildReload(guildId), returns 200 {success:true}; (c) no guildId calls hydrateAll and onGuildReload(null); (d) invalid guildId returns 400 without reload; (e) getScheduler() returning undefined still returns 200; (f) a rejected getSettings returns 500 and does not call reload; (g) GET /health returns 200 without auth, other paths return 404.
- apps/web unit test for notifyBotReload with a mocked fetch and env: no-op when env vars are unset; the URL equals `${BOT_WEBHOOK_URL}/webhook/reload?guildId=...` with the Authorization header; a fetch rejection is swallowed.

Add after the change: scope=settings skips scheduler.reload() but still performs the guild reload and honeypot sync; scope omitted, scope=schedules, scope=youtube, and scope=garbage all still call reload(); notifyBotReload(guildId, "settings") appends `&scope=settings` and the default call's URL is unchanged. Optionally add a route-level assertion that the other five call sites do not pass a scope.

### P17
**Web imports the @dragonbot/db root, pulling the postgres-js client module into web bundles**

Impact **low** (the finder said low) · Effort **S** · Category performance

Locations: `packages/db/src/index.ts:4`, `apps/web/src/app/api/guilds/route.ts:3`, `apps/web/src/app/api/server/[guildId]/route.ts:3`, `apps/web/src/lib/validators.ts:2`

**What the code does.** index.ts re-exports createBotClient (client.ts imports `postgres`) and createServerlessClient. ~12-13 web files import the root rather than '@dragonbot/db/schema' (already an export used by auth.ts, discord.ts), so postgres-js is in the module graph for web routes even though web uses neon-http. packages/db has no sideEffects flag.

**Verifier's notes.** The core claim holds. packages/db/src/index.ts re-exports createBotClient from ./client, and client.ts imports `postgres` and `drizzle-orm/postgres-js`. packages/db/package.json exports only ".", "./schema" and "./serverless", and has no sideEffects field. next.config transpilePackages includes @dragonbot/db, so the package source is bundled. 15 web files import from the "@dragonbot/db" root. 12 are API route handlers; the others are lib/sync.ts, lib/validators.ts and the server [guildId] route, which also uses the root's permissions and honeypot exports. Only auth, profile, lib/discord and lib/db use the /schema or /serverless subpaths. One overstatement: no "use client" file imports @dragonbot/db, so postgres-js never reaches browser bundles. It only enters server and serverless function bundles, as unused code with a small cold-start and bundle-size cost. createBotClient is never called in web. The fix is cheap (add subpath exports and change imports), but the gain is marginal, so the impact is low.

**Fix plan.** Confirmed: packages/db/src/index.ts re-exports createBotClient (client.ts imports `postgres` and drizzle-orm/postgres-js) and createServerlessClient. 13 web files import the bare "@dragonbot/db". packages/db/package.json "exports" only has ".", "./schema", "./serverless". Of the web imports, only these are non-schema symbols: FIELD_SCOPE_MAP, HONEYPOT_CONFLICT_FIELDS, findHoneypotChannelConflict (web/src/app/api/server/[guildId]/route.ts) and HONEYPOT_ACTIONS (web/src/lib/validators.ts). Everything else (guilds, guildAdmins, userXp, scheduledMessages, youtubeSubscriptions, suggestions, syncFlags) lives in schema.ts, which has no heavy imports beyond drizzle-orm and ./honeypot (pure constants).
Steps:
1. packages/db/package.json: add exports "./permissions": "./src/permissions.ts" and "./honeypot": "./src/honeypot.ts". There is no log-events file in the repo at this commit, so skip that subpath unless D4 lands first.
2. In the 13 web files, change `from "@dragonbot/db"` to `"@dragonbot/db/schema"` for the table imports. Split the mixed import in server/[guildId]/route.ts into schema (guilds) plus permissions (FIELD_SCOPE_MAP) plus honeypot (HONEYPOT_CONFLICT_FIELDS, findHoneypotChannelConflict). Point validators.ts at "@dragonbot/db/honeypot".
3. Leave the root index.ts unchanged for the bot (31 bot imports use it). Do not touch apps/bot.
4. Verify: pnpm --filter web typecheck, then next build. Optionally confirm there is no `postgres` in the web graph (grep the .next server traces, or `grep -rl "postgres" .next/server`). Run the bot test suite and typecheck as a regression check.
5. Optional guard: add an ESLint no-restricted-imports rule, or a short AGENT.md note, forbidding the bare "@dragonbot/db" import in apps/web. No dependency change is needed.
The proposed finding is slightly overstated: `export *` re-exports are statically analyzable and Next's webpack/turbopack tree-shaking would likely drop the unused postgres client, so the real runtime gain is probably small. Impact stays low. The change is still safe, cheap, and makes the web/bot boundary explicit.

**Behaviour to keep the same.** 1. The module split gets a second copy of nothing: the table objects are the same module instance (schema.ts), so drizzle identity and relations are unchanged. Honeypot constants are imported by schema.ts itself and resolve to a single module either way.
2. Per-route cold-start module evaluation can change: if the postgres-js module has import-time side effects, they would stop running in web. client.ts appears to have none beyond defining a class and function, so this is benign. Web never calls createBotClient.
3. Subpath exports must be resolvable by every consumer. next.config.ts has transpilePackages ["@dragonbot/db"], and TypeScript needs moduleResolution that honours "exports" (bundler or node16), as "./schema" already does. Without it, a type-only failure could appear.
4. Missing subpath exports fail at build time, not silently, so the risk is caught by typecheck or build.
5. Do not change the root export order or contents, because the bot depends on `export *` semantics. Name collisions are not a concern as the files export distinct names.
6. Confirm no web client component (.tsx) imports the root. A grep showed none do, so server-only imports are unchanged.
7. The db package does not use "sideEffects": false. Adding it would be a separate and riskier change, because the loggers and clients live in modules that could be pruned. Do not add it as part of this finding.

**Tests.** Existing coverage: apps/web has no tests. The bot has tests under apps/bot/tests (honeypot.test.ts, honeypot-enforcer.test.ts, honeypot.service.test.ts and others) that exercise packages/db/src/honeypot.ts through the root import, so they cover the module's logic and show the root export still works for the bot. They do not cover the web routes or the new subpaths.
To add before refactoring:
1. A tiny smoke test, or a build gate in CI, that imports "@dragonbot/db/schema", "@dragonbot/db/permissions" and "@dragonbot/db/honeypot" and asserts the symbols exist. For example, assert that the set of symbols exported by the root equals the union of the subpath modules plus the clients.
2. A characterization test for web/src/lib/validators.ts that checks the accepted and rejected honeypot actions (kick and ban).
3. A characterization test for the server/[guildId] route's FIELD_SCOPE_MAP and honeypot conflict handling, if a route-test harness exists. Otherwise rely on typecheck and next build.
Primary gate: `next build` succeeds and `pnpm typecheck` passes for both apps, plus the unchanged bot test suite.

### P5
**XP is persisted only every 4 hours; startFlushTimer exists but nothing calls it**

Impact **low** (the finder said medium) · Effort **S** · Category performance

Locations: `apps/bot/src/services/xp.service.ts:241`, `apps/bot/src/index.ts:178`, `apps/bot/src/index.ts:181`, `apps/bot/src/commands/leaderboard.ts:88`, `apps/web/src/app/api/server/[guildId]/leaderboard/route.ts:32`

**What the code does.** startFlushTimer/stopFlushTimer (240-263) have no callers; the only periodic flush is the 4-hour sync timer. A hard kill (OOM, SIGKILL, host restart) loses up to 4h of XP in every guild. The 'View Full Leaderboard' button opens the web leaderboard, which reads user_xp from the DB and can be 4h behind in-bot numbers. The flush is already a no-op when nothing is dirty and batches in chunks of 500.

**Verifier's notes.** The facts check out. startFlushTimer and stopFlushTimer (xp.service.ts:240-263) have no callers anywhere in apps/ or packages/ (checked with git grep). The only scheduled flush is the 4-hour syncTimer at index.ts:178-181. The web leaderboard route reads user_xp straight from the database, so it can lag behind the numbers the bot holds in memory. Medium overstates it, for three reasons. (1) AGENT.md:280-287 documents the 4-hour batching as a deliberate choice to keep DB writes down, because Neon charges for compute time. It is a known trade-off, not an accidental bottleneck. (2) Most data-loss cases are already covered. SIGTERM and SIGINT (index.ts:231), uncaughtException (247) and unhandledRejection (257) all flush XP before exit, and /xp-admin can flush by hand. Only SIGKILL, an OOM kill or a host crash loses data. (3) The proposed fix trades away the Neon cost goal on purpose, so it is a product decision rather than a performance fix. What stands is dead code (the unused timer methods) plus a staleness and durability trade-off worth raising with Kevin, so low impact.

**Fix plan.** Confirmed: startFlushTimer/stopFlushTimer (xp.service.ts:240-263) have no callers. The only periodic flush is the 4-hour syncTimer in apps/bot/src/index.ts (~line 178-181), plus flush on shutdown, uncaughtException, unhandledRejection and the xp-admin commands. A behavior-preserving fix exists, since in-memory XP, levels, level-up messages and the leaderboard read paths do not change. Only persistence timing changes.

Option A (recommended, after Kevin picks N):
1. In apps/bot/src/index.ts, right after `await xpService.hydrate();` (line 138), add `xpService.startFlushTimer(N * 60_000);` N is Kevin's choice (5 to 15 min is typical). Put the interval in a named constant.
2. Add `xpService.stopFlushTimer();` in shutdown() before the final flush (optional, since the timer is unref'd), so a timer tick cannot race the shutdown flush.
3. Keep the 4-hour sync timer's `xpService.flush()` unchanged. It is then usually a no-op, and isFlushing guards overlap. Update the log text ("XP flush + ...") and AGENT.md.
4. Do P4 first (the finding says so). Fix the race in flushInternal described under behaviorRisks before shortening the interval.

Option B (no-risk alternative): delete startFlushTimer/stopFlushTimer and flushTimer (finding X2) and document the 4-hour durability window. This leaves the data-loss exposure.

Files touched: apps/bot/src/index.ts, apps/bot/src/services/xp.service.ts (only if fixing the dirty-flag race or adding a stop in shutdown), AGENT.md.

**Behaviour to keep the same.** 1. Dirty-flag race, existing but made far more likely by frequent flushes. flushInternal snapshots dirty entries, awaits repo.batchUpsert per 500-row chunk, then sets entry.dirty = false for ALL snapshotted entries. A message processed during those awaits mutates totalXp and sets dirty = true, and the final loop then clears it. That update is not persisted until the user's next message, and is lost if the process dies. The upserted values are also captured at map() time per chunk, so later chunks may see newer values than earlier ones. Safe fix, to be done first (P4): capture the values written per entry and clear dirty only if the entry still matches, or set dirty = false BEFORE the upsert and re-set it to true on failure.
2. Failure handling: if batchUpsert throws, dirty stays true for all entries (even those in chunks already written). That is fine and retried later. The timer catches and logs the error; keep that.
3. isFlushing overlap: when a periodic flush overlaps a manual flush (xp-admin calls flush() after reset/set/import), flush() logs warn "Flush already in progress, skipping" and RETURNS without waiting. An xp-admin command that expects its changes persisted after `await flush()` may silently get nothing. More frequent timer flushes make this collision more likely. Consider having flush() await the in-flight promise instead of returning (this is a small behavior change, but it fixes a latent bug). Also check xp-admin guild reset/delete paths: the reset marks dirty, and a timer flush between the in-memory reset and the DB delete could interleave.
4. Logging: logger.info("XP data flushed to database") fires on every non-empty flush, so log volume rises. Consider lowering it to debug for timer-driven flushes. flush() with nothing dirty only logs at debug, and does no DB work.
5. Cost: more DB writes and more Neon compute wake-ups (the 4-hour pattern was designed to allow scale-to-zero). With an active guild, a 5-minute timer would keep Neon awake most of the day. Also, batchUpsert sets updatedAt = new Date() for every row, so 'updated' timestamps will change more often. Check that no consumer treats updatedAt as meaningful.
6. Timer is unref'd, so it does not alter process lifetime. The setInterval does not fire before hydration completes if started after hydrate(), so keep that ordering. startFlushTimer clears any existing timer, so it is idempotent. Do not start it before hydrate(), or a flush could run on an empty map (harmless but pointless).
7. Web leaderboard (apps/web .../leaderboard/route.ts) reads user_xp from the DB, so its staleness improves from 4h to N min. That is a visible, intended improvement. Rank or total mismatch between in-bot /leaderboard and the web page would still exist within N min.
8. Multiple-instance caution: if two bot instances ever ran, the upsert is last-writer-wins on absolute values, as it is today.

**Tests.** Existing coverage: grep of apps/bot/tests found no test that references XpService, xp.service or flush. There are no existing tests for flush, the timer, or dirty-flag handling, so coverage is effectively none. Only the pure helpers in utils/xp.ts may be tested elsewhere (not verified).

Characterization tests to add BEFORE changing anything, using vitest with a fake XpRepository (an in-memory batchUpsert spy) and vi.useFakeTimers:
1. flush() with no dirty entries makes no repo call and leaves state unchanged.
2. flush() with N dirty entries calls batchUpsert in chunks of 500 (for example 1,201 entries give 3 calls of 500, 500 and 201). Payload fields and lastMessageAt mapping are correct (0 gives null). All entries are dirty=false afterwards.
3. batchUpsert rejection on the second chunk: flush rejects, entries remain dirty (pin the current behavior), and the next flush retries.
4. Concurrent flush(): the second call returns immediately with a warn log, and only one upsert sequence happens (pins the current skip behavior).
5. Race characterization (expected to FAIL or document current behavior): processMessage during an in-flight batchUpsert, then flush completes. Assert whether dirty is true. Today it is false (the bug). Land the P4 fix, then flip the expectation.
6. startFlushTimer: with fake timers, advancing by intervalMs triggers flush. Calling it twice leaves a single timer (idempotent). stopFlushTimer stops it. A flush rejection is caught and logged and does not throw an unhandled rejection.
7. An index.ts wiring test is probably not worthwhile. Verify manually with a debug log or getStats() after a message: dirtyEntries drops to 0 after N minutes.
After the change, run the apps/bot test suite and typecheck (pnpm turbo typecheck test), then do a manual check against a dev DB that user_xp rows update on the timer.

### P8
**Guild settings cache has no negative caching and no in-flight sharing: every miss is a DB query per event**

Impact **low** (the finder said medium) · Effort **S** · Category performance

Locations: `apps/bot/src/services/guild.service.ts:42`, `apps/bot/src/events/message-create.ts:14`, `apps/bot/src/services/logging.service.ts:21`, `apps/bot/src/events/message-delete.ts:17`, `apps/bot/src/index.ts:126`, `apps/bot/src/index.ts:134`

**What the code does.** getSettings caches only non-null rows (guild.service.ts:50) and doesn't de-duplicate concurrent misses. A guild with no guilds row (guildCreate fires only for guilds joined while online) runs a SELECT on every message, edit, delete and voice event. Events are bound before login (index.ts:126) but hydrateAll runs only in clientReady (134), so the startup window and each post-noteWrite burst send N concurrent identical queries.

**Verifier's notes.** The core claims hold. In guild.service.ts:42-54, getSettings caches only a non-null row (line 50: `if (settings && !this.writtenSince(...))`). It has no in-flight promise map, so concurrent misses each call repo.findByGuildId. The callers named in the finding all use it: message-create.ts:14, message-delete.ts:17, and logging.service.ts:21/34/52 (shouldLog/sendLogEmbed, which run for edit, delete, voice and member events). So a guild with no guilds row sends a SELECT for each event. Rows are created only by guildCreate (events/guild-create.ts:12) and /admin (commands/admin.ts:68). The web dashboard only selects and updates (api/server/[guildId]/route.ts). Nothing at startup runs ensureGuild for guilds already in the cache, so a rowless guild can exist, for example one joined while the bot was offline. index.ts confirms the timing: events load at line 126 and hydrateAll runs only inside clientReady (134), so a startup window and post-write misses exist. The impact claimed is too high, though. The query is a primary-key lookup with LIMIT 1 (guild.repository.ts:8-13). Rowless guilds are an edge case. A post-noteWrite burst costs a handful of duplicate cheap queries once, and then the cache fills. For a bot of this size the real cost is small. The fix is valid and small, but its value is modest, so the impact should be low rather than medium.

**Fix plan.** Only file touched: apps/bot/src/services/guild.service.ts (plus a new test block in apps/bot/tests/services/guild.service.test.ts). Part 1 is behavior-preserving and can ship on its own. Part 2 (negative caching) changes behavior and needs your approval.

Part 1, in-flight sharing:
- Add `private inflight = new Map<string, { readStart: number; promise: Promise<GuildRow | null> }>()`.
- In `getSettings`, keep the cache check first. On a miss, look up `inflight.get(guildId)`. Join it only if `!this.writtenSince(guildId, entry.readStart)`, and `return entry.promise`.
- Otherwise start a new read, synchronously as today. Set `readStart = this.writeCount`, then `promise = this.repo.findByGuildId(guildId).then(settings => { if (settings && !this.writtenSince(guildId, readStart)) this.cache.set(guildId, settings); return settings; })`. Store `{readStart, promise}` in the map.
- Clean up with `.finally(() => { if (this.inflight.get(guildId)?.promise === promise) this.inflight.delete(guildId); })`. The identity check stops a stale read from deleting a newer entry that replaced it after a write. Return the finally-chained promise to callers, or attach the cleanup so that no extra unhandled rejection arises. A rejection must still reach every joiner.
- Do NOT make `getSettingsFresh` or `updateSettings` use the in-flight map. Both must keep issuing their own DB read. `updateSettings` currently calls `repo.findByGuildId` directly, and that must stay.
- Do not change `noteWrite`, `hydrateAll` or `invalidateCache`. Optionally have `hydrateAll` leave the map alone. It is safe, because the `writtenSince` guard already covers it.

Part 2, optional and needs approval: negative-cache nulls with a short TTL.
- Use a separate small TTLCache or a Map of `guildId -> expiresAt`, not the main cache. Putting null in the main cache would make `getAllCached()` return nulls, and `birthday-checker.ts:27` and `honeypot-warning.ts:154` iterate that.
- Clear the negative entry in `noteWrite`, in `getSettingsFresh` when it returns a row, and in `hydrateAll` for each loaded row.
- Skip it unless the extra DB load is measured. Part 1 already removes the burst cost. The steady state for an unregistered guild is one SELECT per event, and that is the only thing negative caching would save.

**Behaviour to keep the same.** 1. Stale join. A caller must never join a read that started before a later write. The `writtenSince(guildId, entry.readStart)` check is the guard. Without it, a read in flight across `ensureGuild`, `updateSettings`, `setHoneypotWarning`, `disableBanSync` or `invalidateCache` would hand the old row to callers that arrive after the write. Previously those callers issued a fresh read.
2. Write during an in-flight read. The read caller that started before the write still gets the old row but must not cache it. Keep the `writtenSince` check inside the shared promise, evaluated with the original readStart. Callers that arrive after the write must start a new read and replace the map entry.
3. Map cleanup. A stale read finishing later must not delete the newer entry (use the identity check). Delete the entry on both resolve and reject, or one failed query would poison later calls.
4. Error semantics. Today each concurrent caller gets its own DB error. With sharing, all joiners get the same rejection. That is acceptable but observable. Check that events such as message-create keep their current try/catch.
5. Shared object reference. Joiners now receive the same row object. Today callers already share the cached object, so no new mutation risk, but confirm that no caller mutates the returned row.
6. Query count and timing. `repo.findByGuildId` is now called fewer times under concurrency. Any test that counts calls with concurrent callers will change. The existing tests are sequential, so their counts hold. The miss path must still call the repo synchronously, with no new `await` before it, so `readStart` stays aligned with call order.
7. `getSettingsFresh` must keep bypassing the cache and the in-flight map. Its null handling also stays unchanged: it invalidates the main cache entry. If negative caching is added, it must clear the negative entry on a returned row.
8. Negative caching (Part 2 only) has these risks. A new row created by the web dashboard or by `guildCreate` stays invisible for up to the TTL, unless every row-creating path calls `noteWrite`. Verify that the dashboard path calls `invalidateCache`. Nulls must not leak into `getAllCached()`. Handle the 24h TTLCache cleanup timer and `unref` if a second TTLCache is used.
9. The existing 24h main-cache TTL and `hydrateAll` semantics are unchanged.

**Tests.** Existing coverage: apps/bot/tests/services/guild.service.test.ts already covers the following.
- `getSettingsFresh` bypass and refresh.
- `getSettingsFresh` dropping the cache on a null row.
- `setHoneypotWarning` invalidation.
- "doesn't cache a row read across a write", looped over all 5 write methods.
- "doesn't cache a fresh row read across a write".
- The `hydrateAll` write race.

All of these must pass unmodified. The event handlers, `logging.service.test.ts` and the other service tests mock GuildService or use it sequentially.

Characterization tests to add BEFORE the refactor (they should pass on current code, except where noted):
1. Sequential miss on a null row calls the repo each time. This pins the no-negative-cache behavior. If Part 2 is approved, change this test deliberately.
2. `getAllCached()` returns only non-null rows after a null miss.
3. A rejected `findByGuildId` propagates to the caller and the next call retries the DB (no poisoned state).
4. `getSettings` after `getSettingsFresh` returns the cached fresh row.

Tests to add WITH the fix:
5. Concurrency: N parallel `getSettings("g1")` on a cold cache with a deferred `findByGuildId` produce 1 repo call, and all N get the same row. Afterwards it is cached, and a 2nd call is a cache hit with no repo call.
6. Stale-join guard: start read A (pending), run `invalidateCache` or `updateSettings` (a write), then call `getSettings` again. It must issue a second repo call (call count 2) and return the post-write row. After A resolves late with the old row, the cache holds the new row, not the old one. Run it across all 5 WRITES.
7. Entry replacement: when A finishes after B started, the in-flight entry for B survives. A caller joining B still shares it.
8. Shared rejection: N concurrent callers all reject when the repo rejects. The next call afterwards starts a fresh read.
9. `getSettingsFresh` concurrent with an in-flight `getSettings` still makes its own repo call.
10. Different guild IDs don't share an in-flight read.
11. Null result shared among concurrent callers, and not cached (call count on the next sequential call is 2).

Run: `pnpm --filter bot test` (vitest) and `pnpm --filter bot typecheck`.

### X1
**Unused AuthService JWT/exchange code, its ErrorCodes, and the JWT_SECRET it forces the bot to require**

Impact **low** (the finder said medium) · Effort **S** · Category dead-code

Locations: `apps/bot/src/services/auth.service.ts:8`, `apps/bot/src/services/auth.service.ts:25`, `apps/bot/src/services/auth.service.ts:45`, `apps/bot/src/services/auth.service.ts:64`, `apps/bot/src/index.ts:76`, `apps/bot/src/config.ts:12`, `apps/bot/src/types/errors.ts:18`

**What the code does.** git grep for exchangeToken, signJwt, verifyJwt in apps/bot finds only declarations (web has its own in apps/web/src/lib/auth.ts:14,32). Only generateToken is called (commands/login.ts:20); the web exchanges tokens itself (apps/web/src/app/api/auth/route.ts:18-41). jwtSecret feeds only the dead sign/verify, yet config.ts:12 makes JWT_SECRET a required 32-char var so the bot exits without it. ErrorCode TOKEN_EXPIRED/USED/NOT_FOUND are referenced only by exchangeToken. A second hand-rolled HS256 is a security-maintenance liability. No bot tests.

**Verifier's notes.** The core claim holds. In apps/bot/src/services/auth.service.ts, exchangeToken (line 25), signJwt (45) and verifyJwt (64) have no callers anywhere in apps/bot, including the 21 bot test files. The only bot caller of the auth service is ctx.services.auth.generateToken in commands/login.ts:20. The loader only finds commands and events, and no dynamic call such as ctx.services.auth.exchangeToken exists.

The web app does the exchange itself in apps/web/src/app/api/auth/route.ts:17-35, using an atomic UPDATE...RETURNING, and signs tokens with the signJwt in its own apps/web/src/lib/auth.ts. The bot's jwtSecret field is read only inside signJwt and verifyJwt. TOKEN_EXPIRED, TOKEN_USED and TOKEN_NOT_FOUND are referenced only in exchangeToken. config.ts:12 still requires JWT_SECRET (at least 32 characters), and index.ts:76 passes it in.

One detail in the finding is wrong: it says the bot has no tests, but apps/bot/tests/ exists. None of those tests touch auth, so the dead-code conclusion stands. The AuthRepository methods findByToken and markUsed may also be dead once exchangeToken goes; this was not checked.

I would lower the impact to low. The dead code has no runtime or performance cost and is never reached, so the hand-rolled HS256 cannot be exploited. What remains is maintenance and clarity, plus one operational cost: the bot needs an environment variable it never uses for anything live, though the web app needs the same secret anyway. Removing the methods is a small change, effort S rather than M. Dropping JWT_SECRET from the bot config changes startup validation, which the finding already notes.

**Fix plan.** Verified by git grep: exchangeToken, signJwt, verifyJwt, jwtSecret and the three TOKEN_* ErrorCodes (TOKEN_EXPIRED/USED/NOT_FOUND) are referenced only inside apps/bot/src/services/auth.service.ts and apps/bot/src/types/errors.ts. The web app has its own independent signJwt/verifyJwt (apps/web/src/lib/auth.ts) and env JWT_SECRET, untouched. Only generateToken is used by the bot (commands/login.ts). Note: INVALID_JWT in errors.ts is also unreferenced (not listed in the finding); it can be removed in the same pass, or left. Effort is S (not M): a single-file deletion plus a few one-line edits.
Step 1 (code-only, zero runtime change): in apps/bot/src/services/auth.service.ts delete exchangeToken, signJwt, verifyJwt; change the constructor to `constructor(private repo: AuthRepository) {}`; drop now-unused imports (AppError, ErrorCode; keep crypto for generateToken's randomBytes). In apps/bot/src/types/errors.ts delete TOKEN_EXPIRED, TOKEN_USED, TOKEN_NOT_FOUND (optionally INVALID_JWT; confirm with git grep first; also the "// Auth" comment header goes if the group empties). In apps/bot/src/index.ts:76 change to `new AuthService(authRepo)`. Run `pnpm --filter bot typecheck` (or tsc) and build to confirm nothing else referenced them.
Step 2 (separate commit, needs Kevin's approval because it changes startup validation): remove JWT_SECRET from the bot envSchema in apps/bot/src/config.ts:12. Then update docs: AGENT.md:216 (JWT_SECRET comment, mark as web-only), README.md:85 and .env.example:18 (keep the var, since web needs it from the shared root .env, but note it is used by web only). Consider also noting in AGENT.md:230 that token exchange and JWT signing happen in the web app only.
Also check AuthRepository: findByToken and markUsed are used by the web? The web uses its own db queries (apps/web/src/app/api/auth/route.ts), so AuthRepository.findByToken and markUsed in the bot will become dead after Step 1; flag as a follow-up deletion (verify with git grep before removing; keep create()).

**Behaviour to keep the same.** 1) Removing JWT_SECRET from the bot envSchema changes startup behavior: the bot would start when JWT_SECRET is unset or shorter than 32 chars, where today it exits with code 1 and an 'Invalid environment variables' message. In deployments that share one .env with the web (which still requires JWT_SECRET min 32), a misconfigured web would no longer be caught by the bot's startup, so the fail-fast check for the shared secret is lost. Keep step 2 separate and approved; if strict behavior preservation is required, leave config.ts as is (or keep the validation but stop passing the value). AppConfig type loses JWT_SECRET, so any consumer of config.JWT_SECRET must be gone (git grep shows only index.ts:76). 2) Removing the three ErrorCodes changes the ErrorCode enum's public surface; any code that maps error codes to user messages by string or exhaustively switches would break. git grep shows no such use, and the web does not import bot code. If the codes are ever stored or logged by string, they would no longer exist, but nothing emits them today. 3) generateToken must remain byte-for-byte equivalent: 32 random bytes hex (64 chars), 5-minute expiry, repo.create with {discordId, token, commandInteractionId, expiresAt}. Do not touch it. 4) Keep the `crypto` import (randomBytes). 5) BotContext type (types/context.ts:35) references AuthService as a type only; constructor signature change does not affect it. 6) The web exchange flow is independent, so no change to the /login token-to-JWT handshake. 7) No dependency on bot signing JWTs that web verifies: confirm no external consumer (scripts, other services) calls the bot to sign JWTs; the bot exposes no HTTP route using it (the webhook server uses BOT_WEBHOOK_SECRET, not JWT_SECRET) — spot-check the webhook server before step 2.

**Tests.** Existing coverage: none. apps/bot/tests has no auth.service test and no login command test; the closest are other service tests (e.g. guild.service.test.ts) that show the mocking style. No test touches config.ts. Before refactoring, add: (a) apps/bot/tests/services/auth.service.test.ts characterizing generateToken with a mocked AuthRepository and fake timers: returns a 64-char hex string, repo.create called once with the same token, discordId, commandInteractionId (including undefined), and expiresAt exactly now + 300000 ms; two calls return different tokens. These pass before and after the deletion and lock in the one retained behavior. (b) A config.test.ts for loadConfig using a valid env fixture: with JWT_SECRET present passes; for Step 2, a test asserting the bot starts without JWT_SECRET (written after approval, replacing the characterization that currently expects process.exit(1) when JWT_SECRET is missing or shorter than 32). (c) The compile-time check (tsc/typecheck over apps/bot) serves as the safety net for the deletions, since the removed members have no runtime callers. No need to write tests for the deleted methods; if desired, capture a one-off characterization before deletion, then delete it with the code.

### X10
**Stale web internals: exported getDb, DiscordUser.discriminator, unneeded dynamic imports, legacy Bearer fallback**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/web/src/lib/db.ts:6`, `apps/web/src/lib/discord.ts:23`, `apps/web/src/lib/auth.ts:59`, `apps/web/src/lib/auth.ts:98`

**What the code does.** getDb is exported but used only at db.ts:16. DiscordUser.discriminator is never read. getAuthenticatedUser uses dynamic imports 'to avoid circular deps' (auth.ts:98-100), but db.ts imports only env.ts so no cycle exists. The Authorization Bearer fallback ('backward compat', auth.ts:59-62, 84-86) has no sender in apps/web/src, though external clients cannot be ruled out. (The redundant auth_tokens index is covered in P14.)

**Verifier's notes.** Every claim matches the code. getDb (db.ts:6) has one caller: the Proxy at db.ts:16. Nothing in apps/ or packages/ imports it. DiscordUser.discriminator (discord.ts:23) is a type field that nothing reads. git grep finds it only on that line. The dynamic imports at auth.ts:101-104 guard against a cycle that does not exist. db.ts imports only @dragonbot/db/serverless and ./env. env.ts imports only zod and a dotenv require. discord.ts already imports ./db statically. A second possible reason for the lazy import would be keeping db out of the edge middleware bundle. That does not apply either: middleware.ts imports only ./lib/rate-limit, and auth.ts is imported only by app/api route handlers. The Bearer fallback (auth.ts:59-65, 84-87) has no sender in the repo. Nothing sends a Bearer header to the web API. The two Bearer strings in the repo are bot-webhook.ts calling the bot's webhook server and that server checking it. dashboard/layout.tsx says the cookie is sent automatically, so the old localStorage token path is gone. External clients still cannot be ruled out, as the finding says. This is cleanup with essentially no runtime effect, so low impact and small effort are right.

**Fix plan.** All edits are in apps/web/src/lib. (1) db.ts: change `export function getDb` to a non-exported `function getDb`. The Proxy still calls it. A grep of apps/web/src, apps/bot/src and packages found no other use of getDb. (2) discord.ts:23: delete `discriminator: string;` from the local, non-exported DiscordUser interface. It is a type-only cast of res.json() and is never read. (3) auth.ts getAuthenticatedUser: delete the "Lazy import to avoid circular deps" block (lines ~97-100). Add static imports at the top: `import { eq } from "drizzle-orm"; import { users } from "@dragonbot/db/schema"; import { db } from "./db";`. Then change `database.select` to `db.select`. There is no cycle: db.ts imports only @dragonbot/db/serverless and ./env, and auth.ts already imports ./env. middleware.ts does not import auth, so the edge bundle is unaffected. All 13 importers of auth are Node route handlers. (4) Bearer fallback (auth.ts:59-62 and 84-86): leave it in place. Removing it changes the HTTP contract, so ask Kevin first. The only Bearer sender in the repo is bot-webhook, and that goes to the bot, not this API. If Kevin approves, first add a temporary log or counter of Bearer-authenticated requests and check it over a deploy window. Then remove both branches. getDiscordIdFromRequest and getJwtPayloadFromRequest then reduce to cookie-only, and the duplicated cookie-parsing code could be shared as a follow-up (a separate finding). Steps 1-3 are done in one commit. Verify with `pnpm --filter web typecheck` and `next build`. Both are cheap.

**Behaviour to keep the same.** Steps 1-3 have essentially no runtime risk. (a) Static imports of db and schema now load when auth.ts loads, not on the first authenticated call. db.ts creates the client lazily through the Proxy, so there is no connection or env side effect at import. Check that env.ts validation does not throw in a context that imports auth but never touches the DB. auth.ts already imports env at the top and already reads env.JWT_SECRET at module scope, so nothing changes there. (b) A shadowing trap: auth.ts must not import `eq` twice, and `db` must not clash with any local name. (c) The Proxy binds functions to the instance. Using `db.select` directly gives the same behavior as the previous `database.select`, because the dynamic import returned the same Proxy. (d) Bearer removal is the only real risk. Scripts, bots or other clients that send `Authorization: Bearer <jwt>` would start getting 401s. Two details to preserve if it is ever done: cookie takes priority over Bearer, and an invalid cookie currently falls through to Bearer.

**Tests.** The repo has no tests in apps/web (git ls-files shows no test or spec files), so nothing covers this finding, and no test framework is set up. Before the refactor, add characterization tests with a vitest-style harness and a mocked @dragonbot/db/serverless client. They are cheap, but not required for steps 1-2. For getAuthenticatedUser: (1) a valid cookie JWT with an existing user and no jwtInvalidBefore returns the discord id; (2) a missing user row returns null; (3) iat earlier than jwtInvalidBefore returns null; (4) iat later than jwtInvalidBefore returns the id; (5) no credentials returns null; (6) a valid Bearer-only request returns the id, which pins the legacy path so removal is a deliberate change; (7) a bad cookie plus a valid Bearer returns the id (fallthrough). For db.ts: the Proxy creates the client once and binds methods. The type-level changes need only `tsc`. Without a test setup, `tsc --noEmit` plus `next build` is sufficient for steps 1-3.

### X2
**Unused service, scheduler, cache and XpService methods (incl. ScheduledMessageService write path and parseIntervalToCron)**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/bot/src/lib/scheduler.ts:85`, `apps/bot/src/lib/scheduler.ts:110`, `apps/bot/src/lib/scheduler.ts:119`, `apps/bot/src/services/scheduled-message.service.ts:5`, `apps/bot/src/services/scheduled-message.service.ts:105`, `apps/bot/src/services/scheduled-message.service.ts:160`, `apps/bot/src/services/scheduled-message.service.ts:168`, `apps/bot/src/services/suggestion.service.ts:24`, `apps/bot/src/services/suggestion.service.ts:28`, `apps/bot/src/services/user.service.ts:12`, `apps/bot/src/services/user.service.ts:51`, `apps/bot/src/services/xp.service.ts:45`, `apps/bot/src/services/xp.service.ts:51`, `apps/bot/src/services/xp.service.ts:167`, `apps/bot/src/services/xp.service.ts:241`, `apps/bot/src/services/xp.service.ts:258`, `apps/bot/src/services/xp.service.ts:291`, `apps/bot/src/utils/cache.ts:43`, `apps/bot/src/utils/cache.ts:52`, `apps/bot/src/utils/cache.ts:70`, `apps/bot/src/utils/cache.ts:84`

**What the code does.** Declaration-only greps for: reloadJob (only a comment at scheduler.ts:85), stopAll; ScheduledMessageService create/update/toggle/remove and parseIntervalToCron (the web writes scheduled_messages directly with its own cron validator; parseIntervalToCron also repeats the am/pm-to-24h conversion 3 times at 29-33, 40-44, 52-55); SuggestionService.getByGuild/updateStatus; UserService.getOrCreate/updateProfile; XpService.startFlushTimer/stopFlushTimer and flushTimer field (index.ts runs its own 4h setInterval and flushes on shutdown); TTLCache.invalidatePrefix/clear/destroy/size. GuildXpSettings xpExcludedChannelIds/xpExcludedRoleIds are passed to processMessage but never read. resetUser and resetAllInMemory duplicate the zeroing. addJob/removeJob are used only inside scheduler.ts. No tests reference them.

**Verifier's notes.** I could not refute the finding. Every symbol it names appears only at its own declaration across apps/bot/src, apps/bot/tests, apps/web and packages:
- reloadJob: the only other mention is the comment at scheduler.ts:85.
- stopAll: not called in index.ts shutdown or anywhere else.
- parseIntervalToCron: called only by the unused create and update methods.
- ScheduledMessageService create, update, toggle and remove: the bot calls only listByGuild (schedule.ts:39) and passes the service to SchedulerManager.
- SuggestionService.getByGuild and updateStatus.
- UserService.getOrCreate and updateProfile.
- XpService.startFlushTimer, stopFlushTimer and the flushTimer field.
- TTLCache invalidatePrefix, clear, size and destroy: every .size and .clear() hit belongs to a Map, Set or discord.js collection, not a TTLCache.

Commands reach services through ctx.services.<name>.<method>, and grepping the method names covers those calls. The GuildXpSettings exclusion fields are never read inside XpService: processMessage reads only xpCooldownSeconds, xpMin and xpMax. message-create.ts applies the exclusions before calling it. resetUser and resetAllInMemory repeat the same five zeroing lines. addJob and removeJob are called only inside scheduler.ts. No test calls any of these methods, and scheduler.test.ts uses ScheduledMessageService only as a type. The am/pm conversion appears three times in parseIntervalToCron. Impact low is right: removing dead code helps maintenance only and does not affect runtime.

**Fix plan.** All edits are under apps/bot/src. Do them as separate commits, run typecheck and vitest after each, and only after Kevin approves.

1. XpService (services/xp.service.ts). Decide P5 first. index.ts:179 runs its own 4h setInterval, and the flush on shutdown is separate.
   - Delete startFlushTimer (241), stopFlushTimer (258) and the flushTimer field (51).
   - Add `private zero(entry: XpEntry): void` that sets totalXp, level, messageCount, xpMessageCount and lastMessageAt to 0 and dirty to true.
   - Call it from resetUser (167) and resetAllInMemory (291). Keep the `return false` early exit in resetUser and the count++ in resetAllInMemory.
   - Narrow GuildXpSettings (45-46) by dropping xpExcludedChannelIds and xpExcludedRoleIds, and drop them from the call at message-create.ts:106-107. message-create.ts:85-90 already does the exclusion check from `guild` itself, so processMessage never reads these fields. Check the processMessage body first. This step is optional, because an object literal with extra properties would fail typecheck if only one side is edited.
2. scheduler.ts. Delete reloadJob (110) and stopAll (119). Fix the comment at line 85 to say the cache is refreshed only on reload(). Optionally make addJob and removeJob private. tests/lib/scheduler.test.ts references none of them. First confirm index.ts shutdown does not rely on stopAll. The grep shows no caller, and the node-cron tasks end with process exit.
3. ScheduledMessageService. Delete create, update, toggle, remove (105-168) and parseIntervalToCron (5). Keep listByGuild, getAllEnabled, getById, updateLastRun and cronToHuman, which commands/schedule.ts uses. The AppError and ErrorCode imports go unused once the write path is removed. cronToHuman needs neither import, so remove both. The repository methods create, update and delete (scheduled-message.repository.ts:32-66) become dead too, so remove them in the same change or list them as a follow-up.
4. SuggestionService. Delete getByGuild and updateStatus. The matching repo methods findByGuildId and updateStatus (suggestion.repository.ts:18, 25) also become dead.
5. UserService. Delete getOrCreate and updateProfile. This leaves UserRepository.updateProfile dead, and the `users` type import goes unused. getProfile, isVerified, markVerified and markBanned stay.
6. TTLCache (utils/cache.ts). Delete invalidatePrefix, clear and size. Keep destroy if Kevin wants a teardown hook, because it is the only way to stop the cleanup interval. Otherwise delete it, since the interval is unref'd. Keep get, set, invalidate, values and the private cleanup.
7. Verify with `pnpm -w typecheck` (or tsc --noEmit in apps/bot), `pnpm --filter bot vitest run`, and a repo-wide grep for each removed name, including apps/web and packages/db.

**Behaviour to keep the same.** - Runtime: none for the deletions. My grep across apps/bot src and tests found no callers of reloadJob, stopAll, ScheduledMessageService.create/update/toggle/remove, parseIntervalToCron, SuggestionService.getByGuild/updateStatus, UserService.getOrCreate/updateProfile, XpService.startFlushTimer/stopFlushTimer, or TTLCache.invalidatePrefix/clear/size. apps/web writes scheduled_messages directly, so it does not use the bot service.
- Do not delete live code in the same files. cronToHuman is used by commands/schedule.ts. updateLastRun, getById, getAllEnabled and listByGuild are used by the scheduler and commands. XpService.flush, flushing, getStats, getGuildSnapshot and rehydrateGuild are live.
- zero() refactor. resetUser must return false without mutating when the entry is missing. resetAllInMemory must keep its prefix match on `${guildId}:` and its returned count. Both must set lastMessageAt to 0 and dirty to true, exactly as before.
- TTLCache.destroy also calls cache.clear(). No caller exists today, but keep it if a teardown hook is planned. clear() has no caller, and the Map iteration-with-delete in values() and cleanup() is unaffected.
- Removing the bot-side schedule write path removes the option of a future bot slash command writing schedules. This is a product decision for Kevin. The scheduler comment already refers to "admin edits" via the bot, which is stale because the web dashboard is the writer now.
- Narrowing GuildXpSettings is a type-only change. The dead-repo-method cascade (items 3 to 5) is the only part that touches files beyond the cited lines.
- Whether the DB contains other consumers of these repo methods (scripts, packages/db) should be confirmed by grep.

**Tests.** Existing coverage: tests/lib/scheduler.test.ts (2 tests, cross-server isolation in executeJob and testJob) is the only test touching these files. No test references the removed methods. The honeypot tests use TTLCache only through get/set/invalidate/values, which are kept.

Add before the refactor (characterization):
- XpService.resetUser: returns false for an unknown key; for an existing key it zeroes all five fields and sets dirty. resetAllInMemory: zeroes only entries with the guild prefix (not other guilds, and not a guild whose id merely shares a prefix without the colon), returns the correct count, and marks them dirty. A following flush should write them.
- XpService.processMessage with an excluded-channel or excluded-role settings object. This pins that processMessage ignores those fields, so narrowing the type is safe.
- TTLCache: get, set, invalidate and values with expiry, using fake timers.
- SchedulerManager.reload: adds, updates (cron, timezone or updatedAt change) and removes jobs, and the activeJobCount value. This guards the private addJob/removeJob if they are made private.
- A guard that cronToHuman output is unchanged for a handful of expressions.

No tests are needed for the deleted write path beyond the grep and typecheck.

### X3
**Unused repository methods**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/bot/src/repositories/auth.repository.ts:34`, `apps/bot/src/repositories/xp.repository.ts:32`, `apps/bot/src/repositories/xp.repository.ts:86`, `apps/bot/src/repositories/xp.repository.ts:101`, `apps/bot/src/repositories/suggestion.repository.ts:19`, `apps/bot/src/repositories/user.repository.ts:updateProfile`

**What the code does.** git grep -w deleteExpired, findAllForGuild, resetAllForGuild returns only the declaration. XpRepository.findByGuild has no caller (xp-admin.ts:315's .findByGuild is ctx.xpArchiveRepo). SuggestionRepository.findByGuildId and UserRepository.updateProfile are reachable only through the dead service methods in X2. No tests reference them.

**Verifier's notes.** Confirmed with git grep -w across the repo, docs excluded. AuthRepository.deleteExpired (auth.repository.ts:34), XpRepository.findAllForGuild (:86) and XpRepository.resetAllForGuild (:101) appear only at their declarations. XpRepository.findByGuild (:32) has no caller: the only call, xp-admin.ts:315, goes to ctx.xpArchiveRepo.findByGuild, which is the separate XpArchiveRepository method. SuggestionRepository.findByGuildId is declared at line 18, not 19, a minor line error. Its only caller is SuggestionService.getByGuild, and getByGuild is never called anywhere. UserRepository.updateProfile is called only by UserService.updateProfile, which has no callers in apps/bot, apps/web or packages. No tests reference any of these methods; the test hits for findByGuildId are GuildRepository mocks, a different class. These are concrete repository instance methods, not modules, so the dynamic loader in loader.ts does not pick them up, and they are not package exports. Impact is low and the effort is small, as the finding says. One caveat: the comment on XpRepository.findByGuild says it is "used by web dashboard", but nothing in apps/web calls it.

**Fix plan.** Verified by git grep on apps/ and packages/. The finding is correct, with two additions.

Delete these repository methods:
1. apps/bot/src/repositories/auth.repository.ts: remove deleteExpired (lines 34-42). Change the import to `import { eq } from "drizzle-orm";`, since `and` and `lt` are used only there.
2. apps/bot/src/repositories/xp.repository.ts: remove findByGuild (line 32), findAllForGuild (line 86) and resetAllForGuild (line 101), plus their doc comments. XpRow stays, because findAll and others use it. `desc` is used only by findByGuild, at line 44, so it also goes unused. `and` is already unused today, so drop it too. Keep `eq` and `sql`. Check the other methods for `eq` usage before trimming the import. The "used by web dashboard" comment on findByGuild is stale, because the web app has its own queries.
3. apps/bot/src/repositories/suggestion.repository.ts: remove findByGuildId (line 18). `eq` is still used by updateStatus, so the import stays.
4. apps/bot/src/repositories/user.repository.ts: remove updateProfile (line 57). `eq` and `users` are still used.

Delete these service methods in the same change, as the finding says (X2):
- SuggestionService.getByGuild (suggestion.service.ts:24) has no caller.
- UserService.updateProfile (user.service.ts:51) has no caller. After removing it, drop the `import type { users }` on line 2 of user.service.ts if nothing else uses it.

Do not remove GuildRepository.findByGuildId or XpArchiveRepository.findByGuild. Both are live: guild.service, suggestion.service and verification.service call the first, and xp-admin.ts:315 calls the second. Take care that a grep-and-delete does not catch them.

Verify with `pnpm turbo typecheck lint test` (or the repo equivalents). Also run the bot's unused-import/noUnused lint rule, if one exists, to confirm the import cleanup is complete.

**Behaviour to keep the same.** Runtime risk is effectively nil. git grep for deleteExpired, findAllForGuild, resetAllForGuild, XpRepository.findByGuild, SuggestionRepository.findByGuildId, and UserRepository.updateProfile finds only declarations, plus the dead service wrappers. No test references them. Points to guard:
- Name collisions. `findByGuildId` and `findByGuild` are also live methods on GuildRepository and XpArchiveRepository. The test file guild.service.test.ts mocks GuildRepository.findByGuildId, so a broad search-and-replace would break it.
- Removing deleteExpired drops the only code that purges expired auth tokens. It was never scheduled, so tokens already accumulate, and the cleanup is not a behavior change. It may still be worth deciding whether to wire it up instead of deleting it. If so, that is a functional change that needs Kevin's approval. Note that it only deletes tokens that are expired and unused, so used tokens would never be purged either.
- resetAllForGuild is a bulk reset (UPDATE, not DELETE) that xp-admin may be expected to use. Confirm that xp-admin's reset path goes through XpService or an in-memory cache and not this method. Grep shows no caller, so removing it is safe.
- Dynamic or string-keyed access (for example repo[methodName]) would not show up in grep. None was found.
- apps/web does not import bot repositories. I did not find web or db-package usage in the apps/packages grep. Confirm that no scripts outside apps/ and packages/ call these methods.
- Removing UserService.updateProfile also removes its upsert-then-update behavior. Nothing calls it.
- Imports must be cleaned precisely, or noUnusedLocals or lint will fail. The xp.repository.ts `and` import is already unused today.

**Tests.** Existing coverage: none of the six repository methods, or the two dead service wrappers, are referenced in apps/bot/tests. There are no repository tests in the tests directory. Coverage that touches neighbouring code is guild.service.test.ts (GuildRepository.findByGuildId, which must stay untouched) and commands/suggest.test.ts (mocks the suggestion service's create only).

Characterization tests to add first: none are needed for the dead methods themselves, since there is nothing to preserve. Safety nets instead:
1. Run the full existing suite plus `tsc --noEmit` before and after. TypeScript will fail the build if any hidden caller exists, and that is the real guard.
2. Optionally, before deleting, rerun `git grep -nE "\b(deleteExpired|findAllForGuild|resetAllForGuild|getByGuild)\b"` and a grep for `.updateProfile(` and `.findByGuildId(` on the suggestion and user instances. The last run found no callers.
3. If Kevin chooses to wire up deleteExpired instead of deleting it, add a test first for the exact predicate (expired AND unused) and who schedules it.

### X4
**Entirely unused utils/time.ts and utils/course.ts, plus unused logEmbed, COLORS.log and ErrorCode members**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/bot/src/utils/time.ts:1`, `apps/bot/src/utils/time.ts:9`, `apps/bot/src/utils/course.ts:3`, `apps/bot/src/utils/course.ts:7`, `apps/bot/src/utils/embeds.ts:7`, `apps/bot/src/utils/embeds.ts:22`, `apps/bot/src/types/errors.ts:3`, `apps/bot/src/types/errors.ts:5`, `apps/bot/src/types/errors.ts:10`, `apps/bot/src/types/errors.ts:11`, `apps/bot/src/types/errors.ts:21`, `apps/bot/src/types/errors.ts:27`, `apps/bot/src/types/errors.ts:32`, `apps/bot/src/types/errors.ts:34`

**What the code does.** git grep across apps/ and packages/ for formatDate, timeAgo, validateCourseCode, formatCourseCode and the import paths utils/time, utils/course returns only the defining files. logEmbed and COLORS.log have no other reference. ErrorCode NOT_VERIFIED, VERIFICATION_PENDING, GUILD_NOT_CONFIGURED, FEATURE_DISABLED, INVALID_JWT, INSUFFICIENT_PERMISSIONS, UNAUTHORIZED, INTERNAL_ERROR have zero references. No tests.

**Verifier's notes.** Confirmed. Repo-wide git grep for formatDate, timeAgo, validateCourseCode, formatCourseCode and the utils/time and utils/course import paths finds hits only in the files that define them. logEmbed and COLORS.log are referenced only inside embeds.ts. The listed ErrorCode members appear nowhere else in apps/bot. The "UNAUTHORIZED" and "INTERNAL_ERROR" hits in apps/web are string literals in the separate Next.js app and do not import the bot enum. Nothing walks the enum dynamically (no ErrorCode[...] lookup and no Object.values or Object.keys on it). loader.ts dynamically imports only the commands/ and events/ directories, not utils/. Removing all of this is safe and does not change behaviour. The impact is low because these are small helpers that do nothing at runtime.

**Fix plan.** Verified by reading the code and git grep across apps/ and packages/. The finding holds, with one correction: ErrorCode has 8 unreferenced members, and every other member is used in services/commands.

1. git rm apps/bot/src/utils/time.ts and apps/bot/src/utils/course.ts. Nothing references formatDate, timeAgo, validateCourseCode, formatCourseCode or the import paths. The only hits for the tests/utils directory are other utils (audit-log, guild-channel, intro-validator, message-log).
2. apps/bot/src/utils/embeds.ts: delete logEmbed and the `log: 0x5865f2` entry in COLORS. successEmbed, errorEmbed and infoEmbed stay unchanged. COLORS is module-private, so nothing else can use it.
3. apps/bot/src/types/errors.ts: delete NOT_VERIFIED, VERIFICATION_PENDING, GUILD_NOT_CONFIGURED, FEATURE_DISABLED, INVALID_JWT, INSUFFICIENT_PERMISSIONS, UNAUTHORIZED, INTERNAL_ERROR. Keep the other members: VERIFICATION_EXPIRED, INVALID_EMAIL_DOMAIN, ALREADY_VERIFIED, PROFILE_*, TOKEN_*, SUGGESTIONS_DISABLED, ADMIN_NOT_FOUND, NOT_FOUND, VALIDATION_ERROR. Also drop the now-empty "Guild" comment group and the "Permissions" group's INSUFFICIENT_PERMISSIONS line. Keep ADMIN_NOT_FOUND under its heading.
4. Update AGENT.md only if it mentions these files or enum members. Run `git grep -nE "time\.ts|course\.ts|logEmbed|INSUFFICIENT_PERMISSIONS|INVALID_JWT"` over the docs first.
5. Run `pnpm -w typecheck` (or `tsc --noEmit` in apps/bot) and `pnpm --filter bot test`. Run apps/web typecheck too, as a sanity check.

This is a single small commit. It is reversible, and the user must approve it before any change.

**Behaviour to keep the same.** Very low. Points to guard against:
- AppError.code is the only consumer of ErrorCode. Values are never serialized in the code that was read, but check that no web, API or JSON path forwards `err.code`. Run `git grep -n "\.code" apps/bot/src` and confirm that the command handlers only use err.message. If a handler ever switched on or logged a deleted code string, behavior would change only for a code that is never thrown, so nothing can reach it.
- The remaining enum members are string-valued and not numeric, so removing members does not shift any values. Keep the string values of the retained members exactly as they are.
- A TS enum deletion is a compile-time-only change. No runtime import of the removed members exists, as grep shows. A dynamic access such as `ErrorCode[x]` or `Object.values(ErrorCode)` would be the one hidden risk, and grep found none.
- The logEmbed removal does not touch the retained embed colors (success 0x43b581, error 0xff0000, info 0xffcc00). Do not reorder or retype them.
- The removed time and course helpers have no callers. Anything such as slash-command option choices or the web app that carries a copy of this logic is independent.
- Deleting tracked files will show in git. The tsbuildinfo file is already dirty in the worktree, so do not stage it.
- Possible intent: the honeypot or logging work on this branch may plan to use logEmbed or COLORS.log. Confirm with the user that nothing in flight on other branches uses them.

**Tests.** Existing coverage: none directly. There are no tests for time.ts, course.ts, embeds.ts or errors.ts. The existing suites (tests/services/*, tests/commands/suggest.test.ts, tests/utils/*) exercise code that imports AppError and ErrorCode, so a compile or test run will catch any remaining reference to a deleted member. They use RESTJSONErrorCodes from discord.js, which is unrelated.

Characterization tests to add first are optional and minimal, because deleting unreferenced code needs no behavioral pin:
- A small tests/types/errors.test.ts asserting that AppError carries its code and message and that its name is "AppError". It could also snapshot the retained ErrorCode values, which guards against accidental edits to them.
- A tests/utils/embeds.test.ts asserting that successEmbed, errorEmbed and infoEmbed produce the expected color and description (0x43b581, 0xff0000, 0xffcc00).
The real gate is a typecheck (tsc --noEmit) plus the full vitest run before and after the deletion, with the same pass count.

### X5
**Unused BotContext fields (db, email, birthdayChecker, youtubeChecker)**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/bot/src/types/context.ts:26`, `apps/bot/src/types/context.ts:28`, `apps/bot/src/types/context.ts:48`, `apps/bot/src/types/context.ts:49`, `apps/bot/src/index.ts:94`, `apps/bot/src/index.ts:98`, `apps/bot/src/index.ts:148`, `apps/bot/src/index.ts:155`

**What the code does.** ctx.birthdayChecker and ctx.youtubeChecker are assigned in index.ts but never read. grep for ctx.db / ctx.email returns nothing in apps/bot/src or tests (email reaches VerificationService via its constructor). Tests cast ctx via `as unknown as BotContext`.

**Verifier's notes.** The finding holds. The four fields are declared at context.ts:26, 28, 48 and 49. index.ts sets ctx.db and ctx.email in the context literal (lines 94 and 96; the finding cites 98, which is `config`, so that line number is off), sets ctx.birthdayChecker at line 148, and sets ctx.youtubeChecker at line 155. I grepped apps/bot/src and apps/bot/tests for `<identifier>.(db|email|birthdayChecker|youtubeChecker)` (excluding this.db), for destructuring from ctx or context, and for bracket access. None of the four fields is read anywhere; the only hits are the two assignments and unrelated `.email` properties on verification results. The 4-hour sync timer and webhook use the local variables `birthdayChecker`, `youtubeChecker` and `scheduler`, so those instances stay referenced after the fields are removed. Nothing else in index.ts touches ctx after line 200. The loader passes ctx to events and commands, but none of them reads these fields. Removing them is low-impact cleanup (S effort) that changes no behaviour.

**Fix plan.** Verified by grep across apps/ (excluding node_modules): no reader of ctx.db, ctx.email, ctx.birthdayChecker or ctx.youtubeChecker, no destructuring of db/email from a context, and the only object literal typed BotContext is index.ts:93. Steps: (1) apps/bot/src/types/context.ts: delete the db, email, birthdayChecker and youtubeChecker fields (lines 26, 28, 48, 49) plus the now-unused imports DrizzleClient, EmailService, BirthdayChecker, YouTubeChecker. Keep the Logger import. (2) apps/bot/src/index.ts: remove `db,` (line 94) and `email,` (line 96) from the ctx literal, and delete `ctx.birthdayChecker = birthdayChecker;` (148) and `ctx.youtubeChecker = youtubeChecker;` (155). The local consts stay; the 4h setInterval closure (lines ~184-185) still references both, so they remain live. The local `db` and `email` consts are still used for repos and VerificationService, so they stay. (3) Update AGENT.md if it lists these BotContext fields. (4) Run `pnpm --filter bot tsc --noEmit` (or the turbo typecheck) and the bot vitest suite.

**Behaviour to keep the same.** Very low. (a) Garbage collection: the checkers remain strongly reachable via the setInterval callback closure (timer is unref'd but still held by the Node timer list), so their lifetime is unchanged. Do not drop the local consts. (b) Do not remove the local `db`/`email` variables in index.ts, since repos and VerificationService use them. (c) Future code that wants ctx.db would need re-adding, a design choice only, no runtime effect. (d) Type-level only: any test or file building a BotContext literal with db/email would hit an excess-property error. None found, and tests cast via `as unknown as BotContext`, which is unaffected. (e) Optional-field removal changes no property enumeration that anything relies on (nothing serializes or spreads ctx, as far as grep shows). (f) Keep the order of `await birthdayChecker.check()` and `await youtubeChecker.check()` and the log lines unchanged.

**Tests.** No new characterization test is strictly needed, because the change is type-level plus deleted assignments. Existing coverage: apps/bot/tests/lib/birthday-checker.test.ts and apps/bot/tests/lib/youtube-checker.test.ts cover checker behavior, and the event and command tests (e.g. tests/events/*.test.ts, tests/commands/suggest.test.ts) build ctx via `as unknown as BotContext` and are unaffected. The real safety net is the TypeScript compile (tsc/turbo typecheck) over apps/bot, which fails on any missed reader. Optional: a grep guard before merge (`grep -rnE "ctx\.(db|email|birthdayChecker|youtubeChecker)"` returns nothing). index.ts startup wiring has no unit test, so do one manual smoke run of the bot to confirm both checkers still run on startup and on the 4h timer, which is the only behavior to confirm.

### X6
**Superfluous exports (used only in-file) and stale @types/node-cron**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/bot/src/services/xp.service.ts:5`, `apps/bot/src/services/xp.service.ts:14`, `apps/bot/src/services/xp.service.ts:20`, `apps/bot/src/utils/xp.ts:7`, `apps/bot/src/utils/xp.ts:12`, `apps/bot/src/services/logging.service.ts:6`, `apps/bot/src/services/birthday.service.ts:17`, `apps/bot/src/services/scheduled-message.service.ts:5`, `apps/bot/src/lib/honeypot-warning.ts:47`, `apps/bot/src/repositories/xp.repository.ts:5`, `apps/bot/src/repositories/xp-archive.repository.ts:5`, `apps/bot/src/repositories/xp-archive.repository.ts:17`, `apps/bot/src/utils/intro-validator.ts:1`, `apps/bot/package.json:19`, `apps/bot/package.json:27`

**What the code does.** Zero outside-file importers (including tests) for XpEntry, XpProcessResult, XpRankInfo, xpForLevel, totalXpForLevel, LogEventType, UpcomingBirthday, parseIntervalToCron, SyncOptions, XpRow, XpArchiveRow, XpArchiveSnapshotEntry, IntroValidationResult. Test-only exports (honeypot.service constants, ActionRecord, buildWarningEmbed, sweepCachedMessages) are legitimate. @types/node-cron ^3.0.11 is shadowed by node-cron ^4.2.1, which ships its own types.

**Verifier's notes.** I confirmed the claim from the code. I ran git grep across apps/ and packages/, tests included, for all 13 symbols. Each one is referenced only inside the file that declares it. None is re-exported, and apps/bot is a private app with no package exports, so nothing loads these symbols dynamically.

- apps/bot/package.json lists node-cron ^4.2.1 alongside the devDependency @types/node-cron ^3.0.11.
- The installed node-cron 4.2.1 declares its own types (dist/cjs/node-cron.d.ts and dist/esm/node-cron.d.ts), so the @types package is stale.

The cleanup is cosmetic. Keeping the exports costs nothing at runtime, so low impact and small effort are correct.

**Fix plan.** Verified by git grep across apps/ and packages/: all 13 cited symbols (XpEntry, XpProcessResult, XpRankInfo, xpForLevel, totalXpForLevel, LogEventType, UpcomingBirthday, parseIntervalToCron, SyncOptions, XpRow, XpArchiveRow, XpArchiveSnapshotEntry, IntroValidationResult) appear only in their defining file. Steps: (1) Sequence after D4/D13/C2 if those will import LogEventType, UpcomingBirthday or XpArchiveSnapshotEntry; otherwise drop `export` now. (2) Remove the `export` keyword at: xp.service.ts:5,14,20; utils/xp.ts:7,12; logging.service.ts:6; birthday.service.ts:17; scheduled-message.service.ts:5; honeypot-warning.ts:47; xp.repository.ts:5; xp-archive.repository.ts:5,17; intro-validator.ts:1. (3) Remove "@types/node-cron" from apps/bot/package.json devDependencies (line 27) and run pnpm install to refresh pnpm-lock.yaml. Installed node-cron 4.x declares its own types (dist/esm/node-cron.d.ts, dist/cjs/node-cron.d.ts), and its only importer is src/lib/scheduler.ts, so the stale v3 types are not needed. (4) Run pnpm typecheck and pnpm test (vitest). Optional: if noUnusedLocals or a lint rule becomes relevant, check it. Do it in one small commit, after the user approves.

**Behaviour to keep the same.** Runtime: none, because TypeScript erases `export` on interfaces and types, and the functions stay defined and called in-file. Caveats: (a) an exported interface used in the return type of an exported class method can raise TS4xxx errors only if declaration emit is on, so check tsconfig `declaration`. XpEntry, XpRow and similar types are used in public method signatures. (b) parseIntervalToCron is a pure function with no test importer, so un-exporting it blocks later direct unit tests. It is tested only indirectly, so consider keeping it exported if characterization tests are planned. (c) Other open branches or findings (D4/D13/C2) may start importing the symbols, causing merge conflicts or churn. (d) Removing @types/node-cron changes pnpm-lock.yaml. Typecheck could surface differences between the v3 types and v4's bundled types only if v3 types were actually resolved. Node resolves the package's own types first, so the removal should be a no-op, but it is the one item that needs real verification. (e) The local node_modules still contains @types/node-cron until pnpm install runs.

**Tests.** Existing tests: apps/bot/tests/lib/birthday-checker.test.ts, honeypot-warning.test.ts, services/logging.service.test.ts and utils/intro-validator.test.ts touch the affected modules, but none import the un-exported symbols (verified by grep). No existing tests found for xp utils, xp service/repositories or scheduled-message.service, so they are covered only by typecheck. The type-level change is verified by `pnpm typecheck` (tsc --noEmit) plus the full vitest run. Characterization tests to add first, optional and cheap: a vitest for utils/xp.ts (xpForLevel, totalXpForLevel, level-from-xp boundary values) and for parseIntervalToCron (valid and invalid intervals). The latter needs it to stay exported or to be tested via ScheduledMessageService. No new tests are strictly required, since the change is type-only. Also run pnpm build for apps/bot and apps/web to confirm that nothing else resolves @types/node-cron.

### X7
**Dead markSchedulesDirty helper and orphaned sync_flags table**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/web/src/lib/sync.ts:1`, `apps/web/src/lib/sync.ts:6`, `packages/db/src/schema.ts:184`

**What the code does.** git grep -nw markSchedulesDirty returns only its definition. syncFlags is referenced only by sync.ts and schema.ts; 0 hits in apps/bot. AGENT.md:154 calls the table legacy (cache invalidation now uses the webhook server). tsc --noUnusedLocals also flags the unused `eq` import at sync.ts:1.

**Verifier's notes.** Confirmed. apps/web/src/lib/sync.ts exports only markSchedulesDirty, which writes to syncFlags. A git grep across tracked files (excluding tsbuildinfo) finds no import of lib/sync, @/lib/sync or ./sync, and no caller of markSchedulesDirty. A Next.js route cannot load it because it lives in src/lib, not app/. syncFlags and sync_flags appear only in sync.ts, schema.ts:184 and AGENT.md:154, which calls the table "legacy". There are no hits in apps/bot, no raw-SQL use of the table, and no tests. Deleting sync.ts is safe and changes no behavior. Removing syncFlags from schema.ts would drop the table on the next drizzle push, so that part rightly needs Kevin's approval. Impact is low: a small piece of dead code with no runtime cost.

**Fix plan.** Phase 1 (safe, no approval risk beyond the normal refactor approval): git rm apps/web/src/lib/sync.ts. I re-ran the grep and confirmed that markSchedulesDirty, syncFlags and sync_flags have no references outside sync.ts (definition and import), schema.ts:184 and AGENT.md:154. The only other hit is the tsbuildinfo cache, which should be ignored. There is no importer of "./sync" or "@/lib/sync" in apps/web or apps/bot, and no dynamic import. After deleting, run `pnpm --filter web exec tsc --noEmit` (or turbo typecheck) and `pnpm --filter web build` to confirm nothing else breaks. Phase 2 (only after Kevin approves a schema change): remove the syncFlags export from packages/db/src/schema.ts (lines 184-189) and delete the AGENT.md:154 bullet. Check whether `boolean` and `text` are still used elsewhere in schema.ts before pruning imports (almost certainly yes). The table will then exist in the production DB without a Drizzle definition. This repo uses `drizzle-kit push` (db:push) and has no migrations folder. A push will propose DROP TABLE sync_flags and prompt for confirmation, so Kevin should either accept the drop on purpose or run a manual `DROP TABLE sync_flags` after confirming it holds no rows he cares about. If he does not want to drop data, leave the table definition in place and only note it as unused in AGENT.md.

**Behaviour to keep the same.** Phase 1: none at runtime. markSchedulesDirty has zero callers, so the deleted function never ran. The unused `eq` import goes away with the file. The web build is unaffected, because Next only bundles imported modules. Phase 2: it is a data/schema change. `drizzle-kit push` will want to drop sync_flags and will warn about data loss. It also affects anything outside this repo that reads sync_flags, such as manual SQL, an old bot deployment still running a version that polls the table, or an external dashboard. The git grep covers only this repo, so check that the deployed bot is on the webhook-based invalidation before dropping. If the web app were deployed with sync.ts removed while an older bot still polled the flag, nothing would break, because nothing writes it today anyway. Also keep the schema export and the real table in step with each other. Removing the export without dropping the table is harmless, since push only acts when run, but it leaves an orphan table.

**Tests.** Existing tests: no test references sync.ts, syncFlags or markSchedulesDirty. The test files seen are all under apps/bot/tests (commands, db/honeypot, events, lib), so none cover this code. No characterization test is needed for Phase 1, because deleting code with no callers has no behavior to characterize. The verification is static: tsc --noEmit for apps/web, the web build, and the existing bot test suite (`pnpm test`) as a regression check. Optionally add a one-off CI/grep guard step, `git grep -nw markSchedulesDirty` returning empty. For Phase 2, before running the push, run `SELECT count(*), max(updated_at) FROM sync_flags` against production to confirm the table is stale, and run `drizzle-kit push` against a staging DB first to review the generated SQL.

### X8
**Unused SUBCOMMAND_SCOPE_MAP export**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `packages/db/src/permissions.ts:21`

**What the code does.** git grep SUBCOMMAND_SCOPE_MAP returns only its definition; admin.ts imports only PERMISSION_SCOPES. FIELD_SCOPE_MAP and PERMISSION_SCOPES in the same file are used. Its presence suggests a per-subcommand enforcement that does not exist.

**Verifier's notes.** I confirmed the finding. In packages/db/src/permissions.ts, line 21 defines `export const SUBCOMMAND_SCOPE_MAP` with its doc comment on line 20; the map closes on line 41. Running `git grep SUBCOMMAND_SCOPE_MAP` across the whole repo finds only that definition: no source, test or docs file mentions it, and apps/web does not use it either. The package exports only ".", "./schema" and "./serverless", so the only way to reach the map is the barrel export, and nothing imports it from there. admin.ts and guild-admin.service.ts import only PERMISSION_SCOPES (plus the PermissionScope type). Only the web route `api/server/[guildId]/route.ts` and tests/db/honeypot.test.ts import FIELD_SCOPE_MAP. Next.js routing, the bot loader and tests cannot pick the map up, because it is a constant in a db package file, not a command or a route. Deleting lines 20-41 leaves PERMISSION_SCOPES, PermissionScope and FIELD_SCOPE_MAP untouched. It cannot change runtime behaviour; the only possible effect is a type-level break for an external consumer, and none exists. The impact is low and the effort small.

**Fix plan.** Verified finding is accurate. `git grep SUBCOMMAND_SCOPE_MAP` over the whole repo, docs included, returns only the definition at packages/db/src/permissions.ts:21. It is re-exported through `export * from "./permissions"` in packages/db/src/index.ts, but nothing imports it. admin.ts imports only PERMISSION_SCOPES, which it uses at lines 147-150 and 230-233. Steps: (1) In packages/db/src/permissions.ts, delete the JSDoc comment line and the whole SUBCOMMAND_SCOPE_MAP const, from the "Maps bot /admin subcommand names" comment through the closing `};`, plus one adjacent blank line. Keep PERMISSION_SCOPES, PermissionScope and FIELD_SCOPE_MAP. (2) Run `pnpm -r typecheck` or tsc for bot, web and db, then the bot vitest suite. (3) Optionally add a note in AGENT.md that permission enforcement is per field (web PATCH via FIELD_SCOPE_MAP) and not per subcommand. Before deleting, also check whether the web API actually enforces anything for bot /admin subcommands. That is a separate possible gap (no per-subcommand scope check), not caused by this deletion. Do not wire the map in; that would change behavior.

**Behaviour to keep the same.** Near zero. The const is a plain object literal with no side effects, and nothing reads it. Risks: (a) a consumer outside the repo (none exists, since @dragonbot/db is a private workspace package); (b) a dynamic access such as `import * as db` followed by `db["SUBCOMMAND_SCOPE_MAP"]`, which grep did not find; (c) removal makes the absence of per-subcommand enforcement more obvious, so do not "fix" it as part of this change. There is no effect on bundle size or runtime semantics beyond dropping one object allocation at module load. Keep the PermissionScope type export, since FIELD_SCOPE_MAP depends on it.

**Tests.** Existing: apps/bot/tests/db/honeypot.test.ts asserts FIELD_SCOPE_MAP values and does not touch SUBCOMMAND_SCOPE_MAP. No test covers PERMISSION_SCOPES directly, though admin.ts uses it for validation. The compiler is the main safety net: a clean typecheck of bot, web and db proves no importer exists. Optional characterization test to add first, cheap: a test in apps/bot/tests/db asserting that PERMISSION_SCOPES contains the expected 14 values (including "*") and that every FIELD_SCOPE_MAP value is a member of PERMISSION_SCOPES. This pins the surviving exports. No test is needed for the deleted map.

### X9
**Unused locals and write-only state flagged by tsc in the web app**

Impact **low** (the finder said low) · Effort **S** · Category dead-code

Locations: `apps/web/src/app/dashboard/server/[guildId]/page.tsx:3`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:154`, `apps/web/src/app/dashboard/server/[guildId]/page.tsx:251`, `apps/web/src/components/cron-builder.tsx:3`

**What the code does.** tsc --noEmit --noUnusedLocals --noUnusedParameters reports: page.tsx(3) useCallback unused; page.tsx(154) triggerChar never read (setTriggerChar only at :251); cron-builder.tsx(3) useEffect unused (sync.ts eq is covered by X7).

**Verifier's notes.** I confirmed this finding by searching the two files. In apps/web/src/app/dashboard/server/[guildId]/page.tsx, `useCallback` appears only in the import on line 3. `triggerChar` is declared at line 154 and never read; its setter is called only at line 251. In apps/web/src/components/cron-builder.tsx, `useEffect` appears only in the import on line 3. These are unused imports and write-only state that nothing else touches. Removing them would not change any behaviour, apart from skipping a needless state update when the mention popup opens. Low impact and small effort are correct.

**Fix plan.** 1) apps/web/src/app/dashboard/server/[guildId]/page.tsx line 3: drop `useCallback` from the react import (grep shows it appears only on the import line). 2) Same file line 154: delete `const [triggerChar, setTriggerChar] = useState<"#" | "@">("@");`. 3) Line 251: delete `setTriggerChar(bestChar as "#" | "@");`. 4) Line 237: `const bestChar = bestIdx === hashIdx ? "#" : "@";` becomes an unused local once step 3 is done, so delete it too (hashIdx and atIdx stay, since bestIdx uses them). If `useState` is still used elsewhere, which it is, leave that import. 5) apps/web/src/components/cron-builder.tsx line 3: change to `import { useState, useCallback } from "react";`. Do not remove useCallback there, because it is used (2 occurrences). Re-run `tsc --noEmit --noUnusedLocals --noUnusedParameters` on apps/web to confirm the four flagged items are gone, then run the normal web build/lint.

**Behaviour to keep the same.** Very low. triggerChar is write-only: no JSX or logic reads it. So the mention dropdown (showMentions, mentionPos, mentionFilter) is unchanged. Differences to watch: (a) the finding's proposed fix misses that `bestChar` at about line 237 becomes unused after removing the setter call, so remove it too or tsc will flag it. (b) The finding's claim of one fewer re-render is only partly true: setTriggerChar bails out when the value is unchanged, and React batches it with the other setState calls in the same handler, so any render saving is negligible and only occurs on a # to @ switch. Do not cite this as a benefit. (c) Do not touch the order of the remaining setMentionPos, setShowMentions and setMentionFilter calls or the early return. (d) The finding's list implies useEffect is unused in cron-builder, which is true, but useCallback in the same import is still used, so only remove useEffect. (e) Removing a hook import is safe, as the Rules of Hooks concern only call sites.

**Tests.** No automated tests cover apps/web. The only test files in git ls-files are under apps/bot/tests, so none apply. Nothing to characterise beyond a compile check, because the removed state is never read. Verification before and after: (1) `tsc --noEmit` passes with and without the unused flags (the flagged locations should disappear), and `next build` and lint succeed. (2) Manual smoke test in the dashboard editor: type `@` and confirm the popup opens at the cursor with filtering. Type `#` and confirm the channel list opens. Type a space or a newline and confirm it closes. Type more than 30 characters after the trigger and confirm it closes. Optionally add a small React Testing Library test for the mention trigger detection if a web test harness is ever added, but that is not required for this finding.

### C4
**index.ts main() (~210 lines) mixes wiring, background jobs, timers and duplicated crash handlers**

Impact **low** (the finder said medium) · Effort **M** · Category complexity

Locations: `apps/bot/src/index.ts:52`, `apps/bot/src/index.ts:130`, `apps/bot/src/index.ts:179`, `apps/bot/src/index.ts:244`, `apps/bot/src/index.ts:254`, `apps/bot/src/commands/schedule.ts:70`, `apps/bot/src/events/message-delete.ts:19`

**What the code does.** The clientReady callback builds 4 subsystems, mutates optional ctx fields (:143, :148, :155, :161) and starts the webhook server and 4-hour timer; because those fields are optional, use sites need null checks (ctx.scheduler?, ctx.honeypotWarning?). The uncaughtException and unhandledRejection handlers are copies. No tests.

**Verifier's notes.** The core claims check out against the code. main() runs from apps/bot/src/index.ts:52 to :263, about 210 lines. The clientReady callback (:130-206) builds SchedulerManager, BirthdayChecker, YouTubeChecker and HoneypotWarningSync. It assigns ctx.scheduler, ctx.birthdayChecker, ctx.youtubeChecker and ctx.honeypotWarning at :143, :148, :155 and :161; all four are optional fields in types/context.ts:47-50. It then starts the webhook server and the 4-hour timer. The uncaughtException (:244) and unhandledRejection (:254) handlers are copies that differ only in logging err versus reason. No test imports src/index.

I am lowering the impact to low, for three reasons:
(1) The function is a linear, numbered, well-commented composition root that runs once at startup. Its length is mostly flat constructor wiring, so the complexity is close to proportionate for an entry point.
(2) The proposed extraction does not remove the null checks named in the evidence. These fields are optional on purpose: interactions and events (schedule.ts:70, admin.ts:126-131, guild-create.ts:14, message-delete.ts:19, message-delete-bulk.ts:21) can arrive before clientReady finishes. The checks guard a real readiness window, so they are not an artifact of this structure.
(3) The duplicated crash handler is about 8 lines, and folding it into a helper is a trivial win.

One small extra point: ctx.birthdayChecker and ctx.youtubeChecker are assigned but never read anywhere in apps/bot/src.

The refactor is still worth doing as a low-impact, small (S-to-M) cleanup if the load-bearing order noted at :190 and :200 is kept.

**Fix plan.** Verified against apps/bot/src/index.ts (269 lines; main() spans :52-263, clientReady callback :130-206, ~210 lines total). A pure extraction refactor is possible. Steps, all in apps/bot/src (new files under apps/bot/src/bootstrap/ or lib/, index.ts shrinks to orchestration):

1. buildServices(db, config, logger) -> { email, ai, repos, services (the ctx.services shape), xpArchiveRepo, plus the standalone loggingService/guildService/xpService/honeypotService/birthdayService/youtubeService/youtubeRepo/scheduledMessageService handles that clientReady and shutdown use }. Move lines :60-:90 verbatim. Keep construction order and arguments identical (XpService gets logger, VerificationService gets email, AuthService gets JWT_SECRET, ModerationService/LoggingService take guildService). Construction has no side effects, so order is low risk, but keep it anyway. Return a typed Services object; build ctx (:93-:115) from it.

2. startBackgroundJobs(client, ctx, deps) -> Promise<void>, extracted from the clientReady body, keeping this exact sequence:
   a. log "Bot is online" (user tag, guild count)
   b. guildService.hydrateAll(), log "Guild settings hydrated"
   c. xpService.hydrate()
   d. new SchedulerManager(...); await loadAll(); ctx.scheduler = scheduler
   e. new BirthdayChecker; await check(); ctx.birthdayChecker = ...; log "Birthday checker initialized"
   f. new YouTubeChecker; await check(); ctx.youtubeChecker = ...; log "YouTube checker initialized"
   g. new HoneypotWarningSync; ctx.honeypotWarning = ... (no await, no check)
   h. if BOT_WEBHOOK_SECRET: startWebhookServer with getScheduler: () => ctx.scheduler (keep the lazy getter, not a captured value) and the onGuildReload closure.
   i. startPeriodicSync(...) (setInterval + unref)
   j. final honeypotWarning.syncAll() in its own try/catch with "Startup honeypot warning sync failed".
   Keep the client.once("clientReady", ...) registration in index.ts (or in startBackgroundJobs's caller) and keep it registered BEFORE client.login, as now (:130 vs :209).

3. startPeriodicSync({ xpService, guildService, scheduler, birthdayChecker, youtubeChecker, honeypotWarning, logger }) returns the timer: same FOUR_HOURS_MS, same two separate try/catch blocks (first block: flush, hydrateAll, scheduler.reload, birthday check, youtube check, then info log; second block: honeypotWarning.syncAll with "Periodic honeypot warning sync failed"), same unref guard. Preserve the comments at :190 and :200 as the justification for ordering.

4. installProcessHandlers({ logger, xpService, honeypotService, client }) containing the shutdown function (isShuttingDown flag, 8000ms ref'd deadline timer, drain(5_000) before client.destroy() before xpService.flush(), finally clearTimeout + process.exit(0)), SIGTERM/SIGINT registration, and the two crash handlers. Add a private flushAndExit(logger, xpService, fatalMsg, fatalFields) helper; the handlers become: process.on("uncaughtException", err => flushAndExit({ err }, "Uncaught exception — flushing XP before exit")) and process.on("unhandledRejection", reason => flushAndExit({ reason }, "Unhandled rejection — flushing XP before exit")). The helper does logger.fatal(fields, msg); try flush catch logger.error({ err: flushErr }, "Failed to flush XP during crash"); process.exit(1). Note the log field keys differ (err vs reason): pass the full object, do not normalize.

5. Optionally (separate follow-up, coordinate with P10) make ctx.scheduler/birthdayChecker/youtubeChecker/honeypotWarning non-optional. This is NOT behavior-neutral in effect: the optional fields exist because events/commands can fire before clientReady finishes (e.g. schedule.ts:70 returns a user-facing "not available" path when !ctx.scheduler; message-delete.ts:19 uses ctx.honeypotWarning?.). Recommend keeping them optional in this change; only reduce null checks if a ready-gate is introduced, which is a behavior change and out of scope.

Do not touch the main().catch handler or the dotenv bootstrap at top of file (dotenv.config runs between imports at :7, import order is semantic for env loading; the module-level `__dirname2`/`__dirname` duplication can stay).

Verification: pnpm turbo typecheck + lint + test for apps/bot; run the bot against a test guild/DB (or the characterization harness below) and diff the ordered pino log message sequence before/after.

**Behaviour to keep the same.** 1. Startup ordering is load-bearing: scheduler.loadAll, birthday check (which lists servers from the settings cache), YouTube check, honeypot warning construction, webhook server, timer creation, then the final honeypot syncAll LAST so a slow sync cannot delay the webhook server or the timer (comment at :200). Do not move syncAll earlier or await it before startWebhookServer/setInterval.
2. Periodic sync: honeypot syncAll must stay AFTER the birthday check and in its own try/catch (comment :190) so a failure in flush/hydrate/reload/birthday/youtube neither skips it nor is masked. Do not merge the two try blocks; a single log line "Periodic sync complete (...)" only fires if all five steps succeed.
3. ctx field assignment timing: ctx.scheduler is set after loadAll resolves, ctx.birthdayChecker after its first check, ctx.youtubeChecker after its first check, ctx.honeypotWarning before the webhook server. Interactions arriving during startup see these as undefined (schedule.ts:70 guard, message-delete.ts:19 optional call). Eager construction or early assignment of these (e.g. building all four in buildServices) would change what concurrent events observe, and constructing HoneypotWarningSync early is harmless but assigning it early would let message-delete trigger sync before hydration.
4. getScheduler: () => ctx.scheduler must remain a lazy lookup; webhook onGuildReload semantics (guildId ? sync(guildId, {resetBudget:true}) : syncAll()) must be unchanged, including that its returned promise is not awaited/caught by the caller as today.
5. The clientReady callback is async and un-caught: an error in hydrateAll/xpService.hydrate/loadAll/check() currently becomes an unhandled promise rejection -> unhandledRejection handler -> flush XP + exit(1). Wrapping it in a try/catch or helper that swallows errors would change crash behavior. Note also the handlers are registered AFTER client.login resolves (:209 vs :241-262), so a rejection during login or very early ready would hit Node default behavior; keep the registration point after login, and do not hoist installProcessHandlers earlier. Also clientReady can fire before login() resolves, so a failure there precedes handler installation; preserve that.
6. Shutdown ordering: honeypotService.drain(5_000) -> client.destroy() -> xpService.flush(), with 8000ms hard deadline using process.exit(1) and the isShuttingDown guard; finally block always exit(0), even after flush error. SIGTERM/SIGINT callbacks intentionally don't return the promise.
7. Crash handlers: async listeners, fatal log field names differ (err vs reason) and message text differs; both end in exit(1) and do not use the isShuttingDown guard or the 8s deadline (a hung flush during a crash can hang forever, as today). Do not 'improve' by adding the deadline or guard in this refactor; flag it separately.
8. Log message text and field shapes (e.g. "Bot is online", "Guild settings hydrated", "Birthday checker initialized") should be preserved exactly since ops may grep them.
9. Module side effects: index.ts calls main() at import time and loads dotenv between imports; moving code into new modules must not cause those modules to read process.env at import time before dotenv.config runs (config is read via loadConfig() inside main, keep it so). Keep `main()` invocation in index.ts so tests importing the new modules do not start the bot.
10. Interval timer: setInterval callback is async with errors fully caught; keep unref guard (`if (syncTimer.unref)`). Do not switch to a self-rescheduling setTimeout, which would change drift/overlap behavior.
11. If ctx field types are tightened (step 5 option), the TypeScript shape change ripples into every command/event test mock; keep optional.

**Tests.** Existing coverage: no test imports index.ts or exercises main(). Related unit tests exist for the pieces being wired: apps/bot/tests/lib/scheduler.test.ts, birthday-checker.test.ts, youtube-checker.test.ts, honeypot-warning.test.ts, honeypot-enforcer.test.ts, services/honeypot.service.test.ts, services/guild.service.test.ts, events/message-delete.test.ts (covers ctx.honeypotWarning?.sync path indirectly). None cover startup ordering, the periodic sync, shutdown, or crash handlers.

Add BEFORE refactoring (characterization tests, vitest with vi.mock of the heavy modules and vi.useFakeTimers):
1. Startup order test: mock loader, db client, discord client (EventEmitter-like with once/login/destroy), services, SchedulerManager, BirthdayChecker, YouTubeChecker, HoneypotWarningSync, startWebhookServer; import/run main (or the extracted function post-refactor, but write against the current file first by exporting nothing and dynamically importing index.ts with process.exit and main mocked); emit clientReady and assert the call-order log: hydrateAll, xp.hydrate, scheduler.loadAll, birthday.check, youtube.check, startWebhookServer, (timer registered), honeypot.syncAll LAST. Also assert startWebhookServer is NOT called when BOT_WEBHOOK_SECRET is unset, and that ctx.scheduler/birthdayChecker/youtubeChecker/honeypotWarning are set at the points described.
2. Webhook wiring: capture the onGuildReload and getScheduler args; assert onGuildReload("g1") calls honeypotWarning.sync("g1", { resetBudget: true }), onGuildReload(undefined) calls syncAll, getScheduler returns the live ctx.scheduler.
3. Periodic sync: with fake timers advance 4h; assert order flush, hydrateAll, scheduler.reload, birthday.check, youtube.check, then honeypot.syncAll; assert that when youtube.check rejects, syncAll still runs and the "Periodic sync failed" error is logged and the success log is not; assert syncAll rejection logs "Periodic honeypot warning sync failed" and doesn't throw; assert startup syncAll rejection is caught.
4. Crash handlers: spy process.on and process.exit (mock to no-op); invoke registered uncaughtException/unhandledRejection handlers; assert logger.fatal called with ({err}) / ({reason}) and respective messages, xpService.flush called, flush failure logs "Failed to flush XP during crash", and exit(1) in both cases.
5. Shutdown: invoke SIGTERM handler; assert drain(5000) -> client.destroy -> xpService.flush order, exit(0) even when flush throws, second invocation is a no-op, and with a never-resolving drain the 8000ms deadline calls exit(1).
6. Snapshot of the ordered logger.info/warn/error message strings across a full startup+tick+shutdown, saved as the golden file the refactored code must match.

After refactoring, the same tests run unchanged (they target observable behavior via mocks) and, for the extracted functions, add thin direct unit tests for startPeriodicSync and installProcessHandlers. Run pnpm turbo typecheck lint test --filter @dragonbot/bot (or the repo's equivalent) plus a manual smoke start against a dev DB comparing log order.

### D14
**Repeated CRUD handlers and loaders in schedules and YouTube dashboard pages; 401 redirect in 6 places**

Impact **low** (the finder said low) · Effort **M** · Category duplication

Locations: `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:89`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:139`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:202`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:48`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:146`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:202`, `apps/web/src/app/dashboard/layout.tsx:46`

**What the code does.** Both pages load their list plus /discord channels with the same 401/403 handling and have the same handleToggle, startEdit, handleSaveEdit, handleDelete and textChannels filter, differing only in resource name and messages. `if (res.status === 401) { window.location.href = "/" }` appears in 6 files.

**Verifier's notes.** I confirmed the finding from the code. The schedules page (lines 89-185) and the YouTube page (lines 48-200) use the same shape for the load (Promise.all of the list and /discord, with the same 401 redirect, 403 "No permission." and "Failed to load." handling), handleToggle, startEdit, handleSaveEdit, handleDelete and the textChannels filter. They differ in resource names, messages, the fields startEdit copies, and setShowReloadHint, which only schedules calls. YouTube also fetches /api/server/{guildId} to read isYoutubeEnabled, so a shared loader has to allow extra fetches. grep finds `if (res.status === 401) { window.location.href = "/"; return; }` in exactly 6 files: layout.tsx:46, leaderboard/page.tsx:28, [guildId]/page.tsx:531, schedules/page.tsx:94, youtube/page.tsx:54 and suggestions/page.tsx:41. The duplication is real but small: two pages and one-line redirects, with no correctness or performance cost. Low impact is right, and effort is probably S to M.

**Fix plan.** Verified against code. Schedules and YouTube pages have near-identical load effect (Promise.all of list + /discord, 401 -> redirect without clearing loading, 403 -> setError + setLoading(false), ok -> set, catch -> "Failed to load."), handleToggle/startEdit/handleSaveEdit/handleDelete, and an identical textChannels filter. The 401 redirect is actually in 7 places, not 6 (layout.tsx:46, [guildId]/page.tsx:531, schedules:94, youtube:54, leaderboard:28, suggestions:41, plus profile/page.tsx:137 in a different multi-line form that returns null into a .then chain). No test infrastructure exists in apps/web (no test files, no test script).

Safe, minimal-risk plan (do in this order, one commit per step, manually verify each page in the browser):
1. Add apps/web/src/lib/dashboard-utils.ts (or similar) with `isTextChannel(c)` / `filterTextChannels(channels)` = `c.type === "text" || c.type === "announcement"`, and a shared `DiscordChannel` type. Replace the 3 textChannels filters (schedules, youtube, [guildId]/page.tsx:655). Pure, zero risk.
2. Add `redirectToLogin()` (or `handleUnauthorized(res): boolean`) that does `window.location.href = "/"` and returns true when res.status === 401. Replace the 6 identical `if (res.status === 401) { window.location.href = "/"; return; }` sites with `if (isUnauthorized(res)) return;`. Do NOT make it clear loading and do not touch mutation handlers (they currently have no 401 handling; adding it would be a behavior change). Leave profile/page.tsx alone or convert carefully.
3. Add `useGuildChannels(guildId)` only if it can preserve the combined-loading semantics. Recommended narrower form: because both pages load list + discord in ONE Promise.all with shared loading/error state, and YouTube also fetches /api/server/${guildId} (guild.isYoutubeEnabled), a channels-only hook would change timing (loading would resolve independently) and error semantics. Safer: extract `loadGuildResources(guildId, extraFetches)` or keep the effect in each page and only share the 401/403 branch via a small helper. If the hook is used, it must expose `{channels, loading, error}` and each page must still wait for BOTH list and channels before leaving the spinner (loading = listLoaded && channelsLoaded), the 403 check must remain keyed to the list response only (a 403 on /discord is currently ignored and leaves channels empty), and a discord !ok must still silently leave channels = [].
4. Do NOT build a generic `apiJson(url, init)` that throws/returns parsed JSON for all calls. Existing handlers branch on res.ok and then parse either success JSON or error JSON (`data.error ?? "Failed to ..."`), with different fallbacks: handleCreate/handleSaveEdit call res.json() on the error path WITHOUT catch (can throw on non-JSON body), handleModuleToggle uses `.catch(() => ({}))`, handleToggle/handleDelete show nothing on failure. A thin `jsonRequest(method, url, body?)` wrapper that only builds `{method, credentials: "same-origin", headers: Content-Type, body: JSON.stringify}` and returns the raw Response is behavior-identical and removes the repeated fetch boilerplate; leave the res.ok branches and messages in each page.
5. For the CRUD handlers, share only via a factory that takes explicit per-page config (resource path, setItems, success/failure messages, and an optional `onChange` callback). Schedules passes `onChange: () => setShowReloadHint(true)`, YouTube passes nothing. Keep call sites: schedules calls it in handleCreate, handleToggle, handleSaveEdit, handleDelete (all success paths); YouTube never does. Given the pages also differ in form state (embed fields vs resolve flow), startEdit field sets (schedules: 7 fields; YouTube: 3), and create payloads, a full generic CRUD hook gives marginal gain for real risk; recommend stopping after steps 1, 2 and 4 and treating step 5 as optional/low value.
Files touched: apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx, .../youtube/page.tsx, .../[guildId]/page.tsx, .../leaderboard/page.tsx, .../suggestions/page.tsx, dashboard/layout.tsx, plus one new lib file under apps/web/src/lib.

**Behaviour to keep the same.** 1. showReloadHint: schedules sets it true on create, toggle, save-edit, delete (success only); YouTube has no such state. A shared handler must take it as an optional callback and must not fire on failures. Note schedules' handleToggle and handleDelete set it, but YouTube's moduleEnabled toggle is separate and unrelated.
2. 401 handling: on 401 the current code redirects and returns WITHOUT calling setLoading(false) (spinner stays during navigation). A helper that clears loading or sets error would flash UI. Only the primary list/settings response is checked for 401; the /discord response and all mutations (create/toggle/save/delete) are never checked, so adding 401 handling there is a behavior change. layout.tsx's 401 is on /api/guilds and returns before setLoadingGuilds(false). profile/page.tsx uses a different shape (returns null through the promise chain) so it is not a drop-in.
3. Error messages differ: schedules/youtube use "No permission." on 403; [guildId]/page.tsx uses "You don't have permission to manage this server."; leaderboard uses "...to view this server." and "Failed to load leaderboard."; the catch message is "Failed to load." in schedules/youtube/suggestions. A shared helper must take the message as a parameter.
4. 403 is checked only on the list response; a failing /discord response is silently ignored (channels stay []). Non-ok, non-401/403 list responses (e.g. 500) silently leave the list empty with no error. Preserve this.
5. Loading semantics: loading flips to false only after BOTH (all) Promise.all fetches resolve. YouTube also fetches /api/server/${guildId} for isYoutubeEnabled in the same Promise.all; splitting into a separate hook changes when the spinner clears and could cause a flash of moduleEnabled=false.
6. Request-count/ordering: Promise.all fires fetches in parallel; a hook that chains them or fetches /discord twice (once in hook, once in page) would change network behavior. [guildId]/page.tsx also reads roles from /discord so it cannot use a channels-only hook.
7. Error-path JSON parsing is inconsistent on purpose or by accident: handleCreate/handleSaveEdit `await res.json()` with no catch (throws and leaves saving=true on non-JSON error bodies), handleModuleToggle uses `.catch(() => ({}))`, handleResolve wraps in try/catch with "Failed to look up channel.". A unified apiJson that swallows or throws differently would change visible behavior (e.g. stuck "saving" state vs. error message). If fixing, that is a deliberate behavior change to be approved separately.
8. State updates use captured closure arrays (`setSchedules([...schedules, new])`, `schedules.map(...)`), not functional updates; converting to functional updates is a behavior change under rapid interleaved actions, so keep as is unless approved.
9. handleToggle and handleDelete give no feedback on failure; handleDelete always clears deleteConfirmId regardless of success. Keep. handleSaveEdit uses setSaving shared with create; startEdit field lists differ per page.
10. Messages: success strings differ ("Schedule created!" vs "YouTube subscription added!", "Schedule updated!" vs "Subscription updated!", "Schedule deleted." vs "Subscription deleted."); failure fallbacks "Failed to create."/"Failed to update." are the same.
11. useEffect dependency arrays are [guildId]; a custom hook must keep identical dependency behavior to avoid refetch loops or missed refetches when guildId changes (and avoid unstable object params causing extra fetches). The "use client" directive is required on any module with hooks.
12. The finding's count of 6 files is slightly off: 7 sites exist (incl. profile), and the finding location list omits [guildId]/page.tsx, leaderboard, suggestions, profile as hook/helper adopters.

**Tests.** Existing coverage: none. apps/web has no test files and no test script/vitest/jest/playwright config (all existing tests are under apps/bot/tests). The finding's 'No tests' proposal is therefore the current state, but is risky for step 3-5.
Before refactoring, add characterization tests (recommend Vitest + @testing-library/react + jsdom in apps/web, with a mocked global fetch and a stubbed window.location):
- Load effect, schedules and YouTube: (a) list 401 -> window.location.href set to "/" and loading remains true (no error text); (b) list 403 -> "No permission." shown, spinner gone; (c) list 200 + discord 200 -> items rendered, textChannels only text/announcement in the select (voice/category excluded); (d) list 200 + discord 500 -> items rendered, channel select empty, no error; (e) list 500 -> no items, no error; (f) fetch rejects -> "Failed to load."; (g) YouTube: guild response isYoutubeEnabled true/false drives toggle state and spinner waits for all three fetches.
- Handlers, schedules: toggle PATCH body {isEnabled:!current}, success replaces item and shows reload hint, failure shows no hint; create success appends, shows "Schedule created!" and hint, error shows data.error or "Failed to create."; save-edit PATCH body equals editData, success clears editingId/editData, "Schedule updated!" + hint; delete success removes item, "Schedule deleted." + hint, deleteConfirmId cleared on both success and failure.
- Same handler tests for YouTube asserting the reload hint is NEVER rendered and the YouTube-specific messages and startEdit fields (3 fields).
- Assert exact fetch calls (URL, method, credentials: "same-origin", Content-Type header, body JSON) for every handler so the thin request wrapper is provably identical.
- layout/leaderboard/suggestions/[guildId]: one 401 test each asserting redirect-and-no-state-change.
Cheaper alternative if adding a test stack is unwanted: do only steps 1, 2 and 4 (pure filter helper, isUnauthorized helper, request-builder wrapper), verify with `pnpm --filter web typecheck/lint/build`, and manually exercise schedules and YouTube pages (load, 403 via non-admin account, create/toggle/edit/delete, confirm reload hint appears only on Schedules) and an expired-session 401 redirect on each of the 6 pages. Skip steps 3 and 5 unless the characterization tests above exist.

### D16
**Repeated form markup across dashboard pages (label/input class strings; profile's local Input/Select)**

Impact **low** (the finder said low) · Effort **M** · Category duplication

Locations: `apps/web/src/app/dashboard/server/[guildId]/page.tsx:718`, `apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx:254`, `apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx:262`, `apps/web/src/app/dashboard/profile/page.tsx:64`

**What the code does.** The label class string appears 19 times in page.tsx and again throughout schedules, youtube and profile. Profile defines its own Input and Select. Input class strings vary slightly (some lack transition-colors).

**Verifier's notes.** The finding holds. The exact label class string "block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5" appears 41 times across the four cited pages; for example, page.tsx:718 is a Log Events label. The full-width input class appears 10 times. Select class strings come in two near-identical forms: 6 copies with transition-colors and 6 without it. That matches the evidence that the variants differ slightly. profile/page.tsx defines its own local Input component (around line 64) and Select component using the same strings. apps/web/src/components holds only cron-builder.tsx, so there are no shared form primitives. Nothing here is dead or behaviour-specific. The duplication is purely cosmetic and repeated across files, so low impact is right. M effort is reasonable given the number of call sites and the need to keep each variant exact.

**Fix plan.** Feasible, but only if class strings are reproduced byte-for-byte via a variant prop. Verified evidence: label string "block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5" appears 19x in server/[guildId]/page.tsx (the finding's "19 times" is correct), 10x in schedules, 6x in youtube, 6x in profile (plus a mb-3 variant 3x in schedules). Input class strings really vary: base "w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent" appears with/without trailing transition-colors (page.tsx and profile have it; schedules and youtube do not), with cursor-pointer (selects), resize-y min-h-16/20/24 (textareas), and in different token orders (e.g. "focus:border-dc-accent cursor-pointer transition-colors" vs "focus:border-dc-accent transition-colors cursor-pointer"; "resize-y min-h-16 transition-colors"). Also youtube has a flex-1 input variant, and schedules has a color input ("w-full h-[38px] ...") that is not a text field and should stay inline. Steps: (1) Do this after the C3 split of server/[guildId]/page.tsx, so each extracted section file is migrated separately. (2) Create a shared module, e.g. apps/web/src/components/form-fields.tsx, exporting FieldLabel (props: className variant "default" | "spaced" for mb-3, htmlFor/children) and TextInput/SelectInput/TextArea that spread native props. Give each a `transitions` boolean (or an explicit `variant`) that appends/omits "transition-colors", plus a `className` pass-through for min-h-*/flex-1. Do NOT normalise; keep a named variant per distinct existing string. Token order in class strings is not behaviorally significant for CSS (only stylesheet order matters), so reordering is safe, but for rendered-HTML diffing keep the order identical. (3) Migrate one page at a time; for profile, replace the local Input/Select wrappers (label + control, onChange(v: string) adaptor) by thin wrappers over the shared primitives, keeping the (v) => onChange callback signature and the placeholder/option rendering. (4) After each page, diff rendered HTML: render before/after (e.g. a throwaway script using react-dom/server or Playwright DOM snapshot) and compare className strings as sets per element. Reject the "No tests" proposal: use snapshot/DOM comparison as a verification step even if not committed.

**Behaviour to keep the same.** 1) Normalising transition-colors adds a 150ms colour transition on focus to schedules and youtube inputs and removes it nowhere (visible, small). 2) Tailwind class conflicts: if a shared base includes transition-colors and a caller appends something, the order in the generated stylesheet decides, not the string order, so reordering is safe but adding/removing tokens is not. 3) Mixing the label's mb-1.5 and mb-3 variants (schedules uses mb-3 for checkbox-group labels). 4) Select/textarea props (value, onChange, disabled, maxLength, rows, id, htmlFor, aria-*) must pass through unchanged; wrapping in a component that swallows ref, or that changes the DOM structure (extra div around label+input, as profile's local Input does) would alter layout. Only profile wraps label+control in a div; page.tsx pages put them in caller-provided wrappers, so a combined Field component must not be used there. 5) Server-vs-client component boundaries: the shared file must work in both 'use client' pages and any server components (no hooks/state needed, so omit 'use client' unless required). 6) Tailwind v4 content scanning: class strings must remain as full literal strings in source (no string concatenation like `${base} transition-colors` unless every fragment is a complete literal), which is fine for scanning, but avoid building class names dynamically. 7) Non-text inputs (checkbox, color, flex-1 URL input in youtube) should be left alone. 8) Profile's Input/Select component identity changes could remount controls if defined inside render; they are module-level now, keep it so to preserve focus behaviour.

**Tests.** No existing tests cover apps/web: the only tests in the repo are under apps/bot/tests (events, services, lib, utils, commands), and none touch dashboard UI. Before refactoring, add characterization checks: (a) a script or vitest test using react-dom/server (or Playwright DOM snapshot) that renders each of the four pages/components with mocked fetch/session data and records, per label/input/select/textarea element in document order, tag + className + key attributes; commit the baseline snapshot before the change and assert it is identical after (with order-insensitive className comparison if tokens are reordered). (b) Unit tests for the new primitives asserting each variant outputs the exact legacy string. (c) Run `pnpm --filter web exec tsc --noEmit` and `next build` as type/build gates, and do a manual visual pass on the four pages for focus transitions. Without (a), the "No tests" proposal leaves class-string drift undetectable, since the variants differ by single tokens.

### D5
**Log-channel embed boilerplate repeated across 6 event handlers; message-update copies message-log's ID block**

Impact **low** (the finder said medium) · Effort **M** · Category duplication

Locations: `apps/bot/src/events/guild-ban-add.ts:29`, `apps/bot/src/events/guild-member-add.ts:58`, `apps/bot/src/events/guild-member-remove.ts:41`, `apps/bot/src/events/guild-member-remove.ts:69`, `apps/bot/src/events/guild-member-update.ts:22`, `apps/bot/src/events/guild-member-update.ts:59`, `apps/bot/src/events/voice-state-update.ts:15`, `apps/bot/src/events/message-update.ts:35`, `apps/bot/src/events/message-update.ts:47`, `apps/bot/src/utils/message-log.ts:8`, `apps/bot/src/utils/message-log.ts:33`

**What the code does.** Each handler hand-builds the same embed: setAuthor({name: user.tag, iconURL: displayAvatarURL()}), a {name:'User', value:'<@id>'} field, an 'ID' field written as a ```js code-fence template literal (9 copies), setTimestamp() and logging.sendLogEmbed. guild-member-remove builds two near-identical embeds (Member Kicked / Kick) with 4 mutable locals (:19-22). utils/message-log.ts exists so the delete and honeypot logs cannot drift, yet message-update.ts:47-61 repeats its ID block line for line.

**Verifier's notes.** I read all seven cited files, and the facts in the finding hold up. There are exactly 9 ID code-fence template literals: guild-ban-add:43, guild-member-add:72, guild-member-remove:60 and :83, guild-member-update:48 and :73, and voice-state-update:31, :43 and :56. Each handler repeats the same setAuthor({name: tag, iconURL: displayAvatarURL()}), the {name:'User', value:'<@id>'} field, setTimestamp() and sendLogEmbed. guild-member-remove does build two near-identical embeds, and it has the 4 mutable locals at lines 19-22. message-update.ts:47-61 repeats the message-log.ts:33-47 ID block line for line, including the blank line before the closing fence. The message-log.ts doc comment says it exists to stop drift, so this copy works against its stated purpose.

I would lower the impact from medium to low. Nothing is broken: the copies only produce log-channel text. Each handler is short and easy to read. The embeds also differ in color, title, fields, inline flags, whether a thumbnail is set, fallback strings, and the extra Moderator and Channel lines in the ID block. A shared helper would therefore save only a few lines per handler, and building it carries the formatting risk the finding itself describes. The most worthwhile part is the message-update ID block: it is an exact copy, and a messageIdBlockField helper shared with message-log would be a small change with little risk.

**Fix plan.** A behavior-preserving fix exists, as long as the helpers stay thin and every handler keeps its own color, title, field order, inline flags, thumbnail and fallback strings. Do it in two stages and run the snapshot tests unchanged after each.

Stage 0 (tests first, no src changes). See testsNeeded.

Stage 1: add apps/bot/src/utils/log-embeds.ts (pure functions, no I/O). Keep buildMessageDeletedEmbed where it is and import from the new file.
- idBlockField(lines: string[]): APIEmbedField returns { name: "ID", value: "```js\n" + lines.join("\n") + "\n```" }. This is byte-identical to the 8 inline template literals, for example `User: x\nGuild: y`. It must not add a blank trailing line.
- messageIdBlockField(message: Message | PartialMessage): APIEmbedField. It is a separate helper because the message variant ends with "\n\n```": the array has a "" element before the closing fence. Keep the original array join and the original lines: User (author?.id ?? "Unknown"), Message, Channel, Guild, Created Timestamp, Edited Timestamp (?? "null"), Nonce (?? "null"). The guild value is a parameter, because message-log uses message.guildId ?? "Unknown" while message-update uses the guild.id it already has.
- Optional: memberAuthor(user: User | null | undefined) for the setAuthor call. Member-remove and message-update use `tag ?? "Unknown"` and `displayAvatarURL() ?? undefined`. Ban-add, member-add, member-update and voice-state-update pass the user and avatar directly. Either keep two variants or leave the author calls inline. The author is the riskiest part to share, so I would not unify it.
- Optional: a small memberLogEmbed({color,title,user}) is not worth it. Prefer one pure builder per log type, for example buildKickEmbed, buildMemberLeftOrKickedEmbed and buildVoiceEmbed, only where it removes real duplication.

Stage 2: migrate handlers one at a time, one commit each, rerunning the snapshots.
- message-log.ts and message-update.ts: both use messageIdBlockField.
- guild-ban-add, guild-member-add, guild-member-update (x2): idBlockField(["User: …","Guild: …"]).
- voice-state-update: build lines per branch, with Channel for join and leave, and Old Channel and New Channel for switch. Keep the existing ordering in the switch line list: User, Old Channel, New Channel, Guild.
- guild-member-remove: keep the two embeds separate. Use idBlockField(["User: …","Guild: …"]) for "Member Left/Kicked", and idBlockField(["User: …","Moderator: ${executorId ?? 'Unknown'}","Guild: …"]) for "Kick". The 4 mutable locals can become a discriminated union ({action:"left"} | {action:"kicked", executor, executorId, reason}). That is optional, and it risks changing the `<@null> (…)` text, so do it only after the snapshot test pins that text.

Files touched: new apps/bot/src/utils/log-embeds.ts; edits to the six event files and message-log.ts; new tests under apps/bot/tests.

**Behaviour to keep the same.** - Message ID block: it ends with an empty array element, so the output is "...Nonce: x\n\n```". The 8 simple blocks have no blank line. One shared helper that normalizes this changes the log text. Keep two helpers.
- Kick ID block has an extra "Moderator: ${executorId ?? 'Unknown'}" line between User and Guild. Voice blocks have Channel lines, and the switch variant has Old Channel and New Channel. Line order matters.
- Guild value differs by source. message-log uses message.guildId ?? "Unknown". message-update uses guild.id. ban-add uses ban.guild.id. member handlers use member.guild.id.
- User ID fallback differs. Message embeds use author?.id ?? "Unknown" in the ID block, but `<@${author?.id ?? "?"}>` in the field. Other handlers have non-null users. voice-state-update returns early if there is no user.
- Author handling: guild-member-remove and message-update use `user?.tag ?? "Unknown"` and `displayAvatarURL() ?? undefined`. The others call the user directly, so a unified helper that adds fallbacks is harmless in practice but should not alter the output for non-null users.
- Field label differs: "User" in member embeds, "Author" (inline) in message embeds. Do not fold these into one User field helper.
- Thumbnail differs by embed. ban-add, member-add and member-remove (leave/kick) have one. The Kick embed, role, nickname, voice and message-edit embeds do not. member-remove uses setThumbnail(user?.displayAvatarURL() ?? null), where null clears the thumbnail. Keep that.
- Field order: in member-remove, "Kicked by" and "Reason" come before "ID" and only when executor is truthy. The Kick embed has no thumbnail and uses color 0xff6600. Colors differ: ban 0xff0000, join 0x43b581, voice and nickname and edit 0xffcc00, role 0xff0000 or 0xff9900.
- Inline flags: Account Created, Before, After and the message Author and Channel fields are inline: true. Preserve them.
- setTimestamp() is time-dependent, so snapshots must freeze it. Fake timers or stripping the timestamp field both work.
- Moving builders into pure functions must not move any await or shouldLog call. The honeypot takeBanEvent and takeRemoveEvent reads happen before any await. The order of resolveBanReason and shouldLog is load-bearing. Only the embed construction moves.
- Do not touch the early-return logic, such as the oldMessage.partial check, the empty-role-diff check, and the voice 'Mute/deafen' else-return.
- Existing message-update has `.slice(0, 1024)` on contents, `*Not cached*` and `*Empty*` fallbacks. Keep them inline or in a dedicated builder.

**Tests.** Existing coverage (apps/bot/tests):
- utils/message-log.test.ts: the best coverage. It checks the full fields array via toEqual (line 68), including the ID block, and the uncached-message fallbacks. Its ID block is the message variant, so it protects messageIdBlockField.
- events/guild-member-remove.test.ts: checks Kicked by, Reason and User fields via toContainEqual, and that Left has no Kicked by. It does not check the ID blocks, colors, the Kick embed, or thumbnails.
- events/guild-ban-add.test.ts: checks the title and the Reason field via toContainEqual. It does not check the ID block, color, thumbnail or author.
- events/guild-member-add.test.ts: checks only titles and some fields, not the ID block.
- events/message-delete.test.ts: checks the title and Content only. message-delete-bulk and guild-create are not related.
- No tests at all for voice-state-update, guild-member-update or message-update.

Characterization tests to add before any refactor, written against the current code and committed green. Use the existing mock-ctx patterns in the tests/events files.
1. For each of the 6 handlers and each embed variant, assert the whole embed.toJSON() with toEqual or toMatchInlineSnapshot, with the timestamp frozen using vi.useFakeTimers and vi.setSystemTime or by deleting timestamp. Include color, author, title, fields in order with inline flags, thumbnail, and exact ID block strings with \n escapes.
2. Cases to cover: ban (with reason, without reason, honeypot hp reason); member-add; member-remove "Member Left", "Member Kicked" via audit log, "Member Kicked" via honeypot kick, and "Kick" (with and without executorId, which pins the "Moderator: Unknown" and `<@null>` text), plus member.user undefined for the "Unknown" author and null thumbnail; member-update role-added only, role-removed only (color flips to 0xff0000), both, and nickname with null before/after (*None*); voice join, leave, switch, and the early returns for the mute/deafen case and a missing member; message-update with the partial old message (*Not cached*), the long content slice at 1024, a null author (Unknown and ?), and null nonce and editedTimestamp.
3. A parity test that the message-update ID field equals buildMessageDeletedEmbed's ID field for the same message and guild, which locks the two together afterwards.
4. After the refactor, add unit tests for idBlockField and messageIdBlockField (exact strings, the blank line before the closing fence in the message variant only).

### P12
**XP rank and leaderboard reads scan the XP map for all guilds with per-entry copies, twice per /leaderboard**

Impact **low** (the finder said low) · Effort **M** · Category performance

Locations: `apps/bot/src/services/xp.service.ts:125`, `apps/bot/src/services/xp.service.ts:152`, `apps/bot/src/services/xp.service.ts:325`, `apps/bot/src/commands/leaderboard.ts:31`, `apps/bot/src/commands/leaderboard.ts:72`, `apps/bot/src/commands/xp-admin.ts:116`

**What the code does.** getGuildEntries iterates the whole flat xpMap and spreads each match. /leaderboard calls getLeaderboard and getRank, scanning and sorting twice. /xp-admin status sorts with limit 9999 just to count. O(total rows) per command: fine today, grows with guild count.

**Verifier's notes.** I confirmed this from the code. In xp.service.ts, getGuildEntries (line 325) walks the whole flat xpMap, which uses keys of the form `guildId:discordId`, checks each key with startsWith, and spreads every match into a new object. getRank (line 125) and getLeaderboard (line 152) each call it and then sort. leaderboard.ts calls getLeaderboard(guildId, 100) at line 31 and getRank at line 72, so each /leaderboard scans and sorts twice. The `/xp-admin status` command calls getLeaderboard(guildId, 9999) at line 116, which looks like a way to get a count. Nothing else mitigates this: there is no cache and no per-guild index. The cost is O(total rows across all guilds) per command, and it all happens in memory. These are user commands that run rarely, not the message hot path, which looks entries up directly by key. Low impact is correct.

**Fix plan.** Verified in apps/bot/src/services/xp.service.ts: xpMap is a flat Map<"guildId:discordId", XpEntry>; getGuildEntries (l.325) scans every key with startsWith and spreads each match; getRank (l.125) and getLeaderboard (l.152) each call it and sort; getGuildSnapshot (l.279) also uses it. /leaderboard (commands/leaderboard.ts l.31, l.72) calls getLeaderboard(100) then getRank. /xp-admin status (xp-admin.ts l.116) calls getLeaderboard(9999) only to take .length. Only callers outside the service: rank.ts:27, leaderboard.ts:31/72, xp-admin.ts:115/116/166/191/273/287.

Recommended staged plan (the last stage is optional, since the benefit is small).

Stage 0 (tests first, see testsNeeded).

Stage 1 (S, safest, no data-structure change): in xp.service.ts, rewrite getRank so it does not build or sort copies. Scan once over the keys with the guild prefix and compute rank = 1 + (count of entries with totalXp strictly greater than the target) + (count of entries with totalXp equal to the target that appear BEFORE the target in map iteration order). That equals the stable-sort findIndex+1 result. totalUsers is the count of matches. No spread copies. Add countGuildEntries(guildId) and use it in xp-admin status (see the 9999 cap caveat below).

Stage 2 (M, optional): change storage to Map<guildId, Map<discordId, XpEntry>>. Touch points: hydrate (l.61-76, set into the nested map, creating the guild map on first use); processMessage (l.87-94); getRank; getLeaderboard (sort the values() of one guild map; map directly to LeaderboardEntry, no spread); resetUser; flushInternal (iterate guild then user, drop key.split(":")); getStats (sum sizes of the inner maps for totalEntries; dirty count over both levels); getGuildSnapshot; resetAllInMemory (get the guild map, no startsWith); rehydrateGuild; delete getGuildEntries. Keep the public method signatures and return shapes unchanged so no command file needs to change, except xp-admin status calling countGuildEntries.

Do NOT cache a sorted array; invalidation under processMessage/reset/rehydrate adds risk for little gain. Having /leaderboard derive the rank from its own sorted array is not possible for users outside the top 100, so keep getRank as a separate (now allocation-free) call, or add an optional internal helper that sorts once and serves both. The simplest safe choice is Stage 1 only.

**Behaviour to keep the same.** 1) Tie ordering: Array.prototype.sort is stable, so equal totalXp keeps Map insertion order (hydrate order from repo.findAll, then new users in order of first message, rehydrateGuild appends only NEW keys). A nested Map<guild, Map<user>> preserves the same relative order within a guild because inserts occur in the same sequence. Re-setting an existing key (rehydrateGuild, hydrate duplicates) keeps its original position in both structures; do not delete-then-set. A Stage 1 rank counter must count equal-XP entries only if they appear earlier than the target.
2) /xp-admin status currently shows min(guildUsers, 9999) because getLeaderboard(…, 9999) slices. An exact countGuildEntries would differ only above 9999 users in one guild (arguably a bug fix). To be strictly behavior-preserving, return Math.min(count, 9999) or accept and document the change.
3) getRank returns null when the user has no entry; keep this. A user with an entry whose totalXp is 0 (reset or only on-cooldown messages) is still ranked, and totalUsers includes zero-XP users. Leaderboard likewise includes zero-XP entries (resetUser leaves entries in the map). Do not filter them.
4) Returned objects: getLeaderboard builds fresh LeaderboardEntry objects (no dirty field); getGuildSnapshot returns copies without dirty. Callers must not receive live XpEntry references. rank is 1-based by slice index, with no tie-sharing (tied users get different ranks); keep that.
5) getStats.totalEntries must remain the total across all guilds, and dirtyEntries the total dirty count.
6) Key splitting: the current flush splits on ":"; IDs are numeric snowflakes, so equivalent. A nested map removes that, but a test with ":" in an ID would diverge (not realistic).
7) flush marks entries clean only after all chunks succeed; keep that semantic (a failed chunk leaves everything dirty) and the isFlushing guard. Entries mutated during the awaits are marked clean even if they changed mid-flush; this is existing behavior, and the refactor should not fix it silently.
8) resetAllInMemory counts and zeroes entries but leaves them in the map, and rehydrateGuild overwrites without clearing absent ones; keep both as is.
9) Timing and Date.now: processMessage cooldown uses lastMessageAt 0 for new entries; unchanged.

**Tests.** Existing coverage: none. apps/bot/tests/services has only guild, honeypot, logging and moderation service tests, and nothing in tests/ or src references XpService beyond src/index.ts and types/context.ts. There are no command tests for leaderboard, rank or xp-admin that cover this path (verify with grep in tests/commands before starting).

Add apps/bot/tests/services/xp.service.test.ts first (Vitest, mocked XpRepository with findAll and batchUpsert, stub pino logger), as characterization tests that pass on the CURRENT code and must still pass after:
- hydrate then getLeaderboard: ordering by totalXp desc, rank values 1..n, limit slicing, default limit 10, empty guild returns [], and multi-guild isolation (other guild entries excluded).
- Tie ordering: three users with equal totalXp, hydrated in a known order, then one more added via processMessage; assert the exact discordId sequence and rank numbers. Also tie order after rehydrateGuild that overwrites an existing key and adds a new one.
- getRank: null for unknown user or guild; correct rank with ties (earlier-inserted tied user ranks higher); totalUsers; zero-XP entry still ranked and counted; rank agrees with the leaderboard position for every user in a guild (property-style check over a randomized but seeded dataset).
- Returned shapes: getLeaderboard entries have exactly the documented fields, and mutating a returned entry does not change service state (copy semantics); the getGuildSnapshot shape (no dirty field).
- getStats: totalEntries across guilds, dirtyEntries after processMessage, resetUser, resetAllInMemory, rehydrateGuild, and after flush (all clean).
- resetUser and resetAllInMemory: return values (false/true; count only for that guild), fields zeroed, dirty set, entries retained in the leaderboard at 0 XP.
- flush: batchUpsert called with the correct guildId and discordId split, chunking at 500 (for example 1201 dirty entries gives 3 calls), lastMessageAt null when 0, no call when nothing is dirty, dirty cleared only after success, and a rejected batchUpsert leaves entries dirty.
- If countGuildEntries is added: equals getLeaderboard(guild, 9999).length for sizes below 9999, and the cap behavior is decided and tested explicitly.
Use vi.useFakeTimers and a mocked randomXp (or min equals max in settings) so processMessage is deterministic. Optionally add a small benchmark script (not a test) comparing the old and new implementation on about 200k entries across 500 guilds. Then run pnpm --filter bot test and typecheck after each stage; the same characterization suite is the oracle for both Stage 1 and Stage 2.


## Refuted

- **P9: /admin upserts the guild row and invalidates its cache on every call, before permission checks.** The mechanics are real. admin.ts:68 calls ensureGuild before the permission check, and guild.service.ts:71-75 runs repo.upsert and then noteWrite, which drops the cache entry. The finding's harm does not hold up, though. (1) /admin is a rare moderator command, not a hot path. Each call costs one upsert, plus one cache miss on the next getSettings, and that call re-caches the row at guild.service.ts:43-53. message-create.ts:14 makes that call, so an active guild is back in the cache almost at once. (2) The birthday-checker consequence is already handled. The only place birthdayChecker.check() runs is the 4-hour timer in index.ts:179-184. That timer calls guildService.hydrateAll() right before the check, and hydrateAll reloads every guild row into the cache. A guild dropped by /admin is back before the checker iterates getAllCached(). It could only be missed if /admin's write landed during hydrateAll's own read, a window of milliseconds. (3) guild-create.ts:12 also uses ensureGuild, but only on guild join, which is rare too. The fix (cache.set with the row upsert returns) is a harmless micro-improvement, but the effect is negligible, not medium. Running the upsert before the permission check is a behaviour question, not a performance one.
