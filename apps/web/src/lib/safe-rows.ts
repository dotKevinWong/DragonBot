/**
 * Strip server-only columns from rows before they are sent to the browser.
 * These are denylists on purpose: a new column is sent unless it is added here,
 * which matches what the routes did before. Add every new sensitive column here.
 */

/** A guild settings row without its internal `id`. */
export function toSafeGuild<T extends { id: unknown }>(row: T): Omit<T, "id"> {
  const { id: _id, ...safeGuild } = row;
  return safeGuild;
}

/** A user row without its internal id, email, revocation time and ban columns. */
export function toSafeUser<
  T extends { id: unknown; email: unknown; jwtInvalidBefore: unknown; banGuildId: unknown; bannedAt: unknown; isBanned: unknown },
>(row: T): Omit<T, "id" | "email" | "jwtInvalidBefore" | "banGuildId" | "bannedAt" | "isBanned"> {
  const { id: _id, email: _email, jwtInvalidBefore: _jib, banGuildId: _bg, bannedAt: _ba, isBanned: _ib, ...safeUser } = row;
  return safeUser;
}
