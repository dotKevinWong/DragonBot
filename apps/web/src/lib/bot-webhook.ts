import { env } from "./env";

/**
 * Notify the bot to reload guild settings after a web dashboard change.
 * Fire-and-forget — errors are silently ignored so dashboard saves always succeed.
 */
export function notifyBotReload(guildId: string): void {
  if (!env.BOT_WEBHOOK_URL || !env.BOT_WEBHOOK_SECRET) return;

  const url = `${env.BOT_WEBHOOK_URL}/webhook/reload?guildId=${encodeURIComponent(guildId)}`;

  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BOT_WEBHOOK_SECRET}` },
  }).catch((err) => {
    // Log but don't throw — dashboard saves should still succeed; the 4h sync is the fallback
    console.error("[bot-webhook] Failed to notify bot reload:", err instanceof Error ? err.message : err);
  });
}
