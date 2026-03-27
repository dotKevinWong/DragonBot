const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if a request should be rate-limited.
 * @param key — unique key (usually IP + route prefix)
 * @param maxRequests — max requests per window
 * @param windowMs — window duration in ms
 * @returns true if the request should be blocked
 */
export function isRateLimited(key: string, maxRequests = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

// Clean up stale entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now > entry.resetAt) {
        buckets.delete(key);
      }
    }
  }, 300_000);
}
