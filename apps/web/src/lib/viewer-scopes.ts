// Which dashboard write controls to show (audit B1 follow-up). GET /api/server/[guildId] returns the
// caller's grants as `viewerScopes`: ["*"] for the owner, Administrator, Manage Server or a "*" grant,
// otherwise their guild_admins scopes. The write routes check the same grants and answer 403 without
// the scope; the pages use this to hide the controls instead. No React here: the pure check is unit-tested.
import { grantsScope } from "@dragonbot/db/permissions";

/** The scope each feature page's create, edit and delete controls need. */
export type WriteScope = "schedules" | "youtube" | "suggestions";

/**
 * Whether the caller may make changes that need `scope`: a "*" grant or the scope itself.
 * Unknown access (not loaded yet, the request failed, or a response without the field) counts as
 * allowed, so a user with the scope never loses a control; the server still enforces the scope.
 */
export function canWriteScope(viewerScopes: unknown, scope: WriteScope): boolean {
  if (!Array.isArray(viewerScopes)) return true;
  return grantsScope(viewerScopes.filter((s): s is string => typeof s === "string"), scope);
}

/** The one-line note a page shows in place of its write controls. */
export function missingScopeNote(scope: WriteScope): string {
  return `You need the ${scope} permission to make changes.`;
}
