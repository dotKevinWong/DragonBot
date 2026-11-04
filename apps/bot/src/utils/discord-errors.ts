import { DiscordAPIError } from "discord.js";

/** Whether `err` is a Discord API error with one of these JSON error codes (`RESTJSONErrorCodes`). */
export function hasErrorCode(err: unknown, ...codes: number[]): boolean {
  return err instanceof DiscordAPIError && typeof err.code === "number" && codes.includes(err.code);
}

/** Why a call failed: the error's message, or the thrown value as text. Not shortened. */
export function describeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}
