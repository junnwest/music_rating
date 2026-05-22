import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Shared limiters keyed by config string — created lazily
const _limiters = new Map<string, Ratelimit>();

function getLimiter(id: string, requests: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const key = `${id}:${requests}:${windowSeconds}`;
  if (!_limiters.has(key)) {
    _limiters.set(
      key,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
        prefix: `sj:rl:${id}`,
      }),
    );
  }
  return _limiters.get(key)!;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Apply rate limiting to a request. Returns a 429 Response if the limit is
 * exceeded, or null if the request should proceed. Gracefully skips limiting
 * when UPSTASH_REDIS_REST_URL / TOKEN are not configured.
 */
export async function rateLimit(
  req: NextRequest,
  id: string,
  requests: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const limiter = getLimiter(id, requests, windowSeconds);
  if (!limiter) return null; // Upstash not configured — skip

  const ip = getClientIp(req);
  const { success, limit, remaining, reset } = await limiter.limit(ip);

  if (!success) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset),
          'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
        },
      },
    );
  }

  return null;
}
