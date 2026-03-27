/**
 * Simple in-memory TTL cache for reducing database calls.
 * Single-process only — no Redis needed for the bot.
 */
export class TTLCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
    // Clean up expired entries every minute
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Invalidate a specific key */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all keys matching a prefix */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Clear the entire cache */
  clear(): void {
    this.cache.clear();
  }

  /** Get cache stats for debugging */
  get size(): number {
    return this.cache.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }
}
