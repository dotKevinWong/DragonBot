/**
 * Simple in-memory TTL cache for reducing database calls.
 * Single-process only — no Redis needed for the bot.
 */
export class TTLCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
    // Clean up expired entries every minute. Nothing stops it: caches live as long as the process.
    const cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't keep the process alive just for cleanup
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
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

  /** Return all non-expired values. */
  values(): T[] {
    const now = Date.now();
    const result: T[] = [];
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      } else {
        result.push(entry.value);
      }
    }
    return result;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}
