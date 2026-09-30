/**
 * Minimal in-process rate limiter for the unauthenticated API proxies.
 *
 * `/api/geocode`, `/api/cities/search` and `/api/pois/search` forward to paid
 * Google/Mapbox/Geoapify endpoints without a user check — they can't have one,
 * since they're used during onboarding before a user exists. That makes them a
 * way to spend the API budget from outside.
 *
 * Deliberately simple: a fixed window in memory. On serverless each instance
 * keeps its own counter, so this bounds abuse rather than preventing it. It is
 * not a substitute for a real quota if the app is ever opened up more widely.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Drop expired buckets so the map can't grow without bound. */
function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets — for the Retry-After header. */
  retryAfter: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Best-effort client identity. Behind a proxy the first `x-forwarded-for` entry
 * is the client; falling back to a shared bucket is intentional — it throttles
 * conservatively rather than failing open.
 */
export function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/** Ready-made 429 for a rejected request. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests — slow down." }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
    },
  );
}
