/**
 * Analysis Cache — Redis-backed with in-memory fallback.
 * 
 * If REDIS_URL is set (Upstash or any Redis), uses Redis.
 * If not set, falls back to a simple in-memory Map (works fine for single container).
 * 
 * Cache key = normalized video URL
 * TTL = 7 days (viral videos don't change their DNA)
 * 
 * Setup: Get a free Redis at https://upstash.com
 * Add REDIS_URL=rediss://... to your .env and Modal secrets
 */

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// In-memory fallback (used when Redis not configured)
const memoryCache = new Map();
const memoryCacheExpiry = new Map();

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    const Redis = require('ioredis');
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      lazyConnect: true,
      enableOfflineQueue: false, // Don't queue commands when disconnected
    });

    redisClient.on('error', (err) => {
      // Silently handle Redis errors — fall back to memory cache
      console.warn('[Cache] Redis error, falling back to memory:', err.message);
      redisClient = null;
    });

    return redisClient;
  } catch (e) {
    console.warn('[Cache] Redis init failed:', e.message);
    return null;
  }
}

/**
 * Normalize a URL to use as a cache key.
 * Strips tracking params, query strings, etc.
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Keep only the path for TikTok/IG/YouTube — strip all query params
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Get cached analysis for a URL.
 * Returns null if not cached.
 */
async function getCachedAnalysis(videoUrl) {
  const key = `analysis:${normalizeUrl(videoUrl)}`;
  
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        console.log(`[Cache] HIT (Redis): ${key}`);
        return JSON.parse(cached);
      }
    } catch (e) {
      // Redis failed, try memory
    }
  }

  // Memory cache fallback
  const expiry = memoryCacheExpiry.get(key);
  if (expiry && Date.now() < expiry) {
    console.log(`[Cache] HIT (Memory): ${key}`);
    return memoryCache.get(key);
  }
  
  // Expired or not found
  memoryCache.delete(key);
  memoryCacheExpiry.delete(key);
  return null;
}

/**
 * Cache an analysis result for a URL.
 */
async function setCachedAnalysis(videoUrl, analysis) {
  const key = `analysis:${normalizeUrl(videoUrl)}`;
  const value = JSON.stringify(analysis);

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.setex(key, CACHE_TTL_SECONDS, value);
      console.log(`[Cache] SET (Redis): ${key}`);
      return;
    } catch (e) {
      // Fall through to memory cache
    }
  }

  // Memory cache fallback — keep max 500 entries to avoid memory leak
  if (memoryCache.size >= 500) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
    memoryCacheExpiry.delete(firstKey);
  }
  
  memoryCache.set(key, analysis);
  memoryCacheExpiry.set(key, Date.now() + CACHE_TTL_SECONDS * 1000);
  console.log(`[Cache] SET (Memory): ${key}`);
}

/**
 * Get cache stats for monitoring
 */
async function getCacheStats() {
  const redis = getRedisClient();
  return {
    backend: redis ? 'redis' : 'memory',
    memory_entries: memoryCache.size,
    redis_connected: !!redis,
  };
}

module.exports = { getCachedAnalysis, setCachedAnalysis, getCacheStats };
