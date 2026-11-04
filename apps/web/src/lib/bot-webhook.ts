import { env } from "./env";

/**
 * Notify the bot to reload guild settings after a web dashboard change.
 * Fire-and-forget — errors are silently ignored so dashboard saves always succeed.
 *
 * With no scope the bot reloads the guild's settings and all schedules. scope "settings" tells it only the
 * guild's settings changed, so it skips the schedule reload. No caller passes it yet: see the P16 note in
 * docs/audit/2026-11-03-codebase-audit.md (a settings save would stop repairing schedules whose own
 * notification failed, and the bot would stop logging "Schedules synced" on settings saves).
 */
export function notifyBotReload(guildId: string, scope?: "settings"): void {
  if (!env.BOT_WEBHOOK_URL || !env.BOT_WEBHOOK_SECRET) return;

  let url = `${env.BOT_WEBHOOK_URL}/webhook/reload?guildId=${encodeURIComponent(guildId)}`;
  if (scope === "settings") url += "&scope=settings";

  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BOT_WEBHOOK_SECRET}` },
  }).catch((err) => {
    // Log but don't throw — dashboard saves should still succeed; the 4h sync is the fallback
    console.error("[bot-webhook] Failed to notify bot reload:", err instanceof Error ? err.message : err);
  });
}
