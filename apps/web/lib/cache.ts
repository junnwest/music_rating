import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Get a cached value. Returns null if not found or Redis is not configured.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const val = await redis.get<T>(key);
    return val ?? null;
  } catch (err) {
    console.error('[cache] get error:', err);
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds. No-ops if Redis is not configured.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.error('[cache] set error:', err);
  }
}

/**
 * Delete one or more cache keys. No-ops if Redis is not configured.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error('[cache] del error:', err);
  }
}
