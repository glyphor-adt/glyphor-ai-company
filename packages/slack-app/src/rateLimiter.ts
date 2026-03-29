interface RateLimitBucket {
  count: number;
  windowStart: number;
  lastSeen: number;
}

const buckets = new Map<string, RateLimitBucket>();
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanupAt = 0;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now, lastSeen: now });
    cleanupExpiredBuckets(now, windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  bucket.lastSeen = now;

  if (bucket.count <= limit) {
    cleanupExpiredBuckets(now, windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  cleanupExpiredBuckets(now, windowMs);
  return { allowed: false, retryAfterSeconds };
}

function cleanupExpiredBuckets(now: number, windowMs: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastSeen > windowMs) {
      buckets.delete(key);
    }
  }
}
