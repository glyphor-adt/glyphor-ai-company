/**
 * Redis Cache Layer — Unified caching for agent runtime.
 *
 * Wraps GCP Memorystore for Redis via ioredis. Provides typed get/set/getOrSet
 * with TTL management, graceful degradation (all ops return null when Redis is
 * unavailable), and a singleton pattern for shared access across the scheduler.
 */

import Redis from 'ioredis';

// ─── Types ──────────────────────────────────────────────────────

export interface CacheConfig {
  host: string;
  port: number;
  /** TLS enabled — default true for Memorystore */
  tls?: boolean;
  /** Key prefix — isolates environments */
  keyPrefix?: string;
  /** Default TTL in seconds — 300 (5 min) */
  defaultTtlSeconds?: number;
  /** Connect timeout in ms — 5000 */
  connectTimeoutMs?: number;
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
}

// ─── Key patterns ───────────────────────────────────────────────

export const CACHE_KEYS = {
  jit: (role: string, hash: string) => `jit:${role}:${hash}`,
  directive: (id: string) => `directive:${id}`,
  profile: (role: string) => `profile:${role}`,
  reasoning: (role: string) => `reasoning-result:${role}`,
  value: (role: string, hash: string) => `value:${role}:${hash}`,
  wave: (cycle: number) => `wave:${cycle}`,
  pulse: () => 'pulse:current',
  kb: (dept: string) => `kb:${dept}`,
  bulletins: (dept: string) => `bulletins:${dept}`,
  reasoningConfig: (role: string) => `reasoning-config:${role}`,
} as const;

export const CACHE_TTL = {
  jit: 180,            // 3 min — task-specific context
  directive: 300,      // 5 min — founder directives
  profile: 600,        // 10 min — agent personality
  reasoning: 120,      // 2 min — reasoning results
  value: 300,          // 5 min — value assessments
  wave: 600,           // 10 min — wave dispatch context
  pulse: 120,          // 2 min — company pulse
  kb: 600,             // 10 min — knowledge base
  bulletins: 300,      // 5 min — founder bulletins
  reasoningConfig: 600, // 10 min — per-agent reasoning config
} as const;

// ─── RedisCache class ───────────────────────────────────────────

export class RedisCache {
  private client: Redis | null = null;
  private connected = false;
  private connecting = false;
  private config: Required<CacheConfig>;

  constructor(config: CacheConfig) {
    this.config = {
      host: config.host,
      port: config.port,
      tls: config.tls ?? true,
      keyPrefix: config.keyPrefix ?? 'glyphor:',
      defaultTtlSeconds: config.defaultTtlSeconds ?? 300,
      connectTimeoutMs: config.connectTimeoutMs ?? 5000,
    };
  }

  /** Lazy connect — only connects on first operation. */
  async ensureConnected(): Promise<boolean> {
    if (this.connected && this.client) return true;
    if (this.connecting) {
      // Wait for in-flight connection
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return this.connected;
    }

    this.connecting = true;
    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls ? {} : undefined,
        keyPrefix: this.config.keyPrefix,
        connectTimeout: this.config.connectTimeoutMs,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) return null; // stop retrying
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      this.client.on('error', (err) => {
        console.warn('[RedisCache] Connection error:', err.message);
        this.connected = false;
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      console.log('[RedisCache] Connected to Redis');
      return true;
    } catch (err) {
      console.warn('[RedisCache] Failed to connect:', (err as Error).message);
      this.client = null;
      this.connected = false;
      return false;
    } finally {
      this.connecting = false;
    }
  }

  /** Get a cached value. Returns null on miss or error. */
  async get<T>(key: string): Promise<T | null> {
    if (!(await this.ensureConnected()) || !this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      return entry.data;
    } catch {
      return null;
    }
  }

  /** Set a cached value with TTL. */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!(await this.ensureConnected()) || !this.client) return;
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    const entry: CacheEntry<T> = {
      data: value,
      cachedAt: Date.now(),
      ttl,
    };
    try {
      await this.client.setex(key, ttl, JSON.stringify(entry));
    } catch {
      // graceful degradation
    }
  }

  /** Delete a cached key. */
  async del(key: string): Promise<void> {
    if (!(await this.ensureConnected()) || !this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // graceful degradation
    }
  }

  /** Invalidate all keys matching a pattern (uses SCAN for safety). */
  async invalidatePattern(pattern: string): Promise<number> {
    if (!(await this.ensureConnected()) || !this.client) return 0;
    let deleted = 0;
    try {
      const stream = this.client.scanStream({
        match: `${this.config.keyPrefix}${pattern}`,
        count: 100,
      });
      for await (const keys of stream) {
        if ((keys as string[]).length > 0) {
          // Strip prefix since ioredis adds it automatically
          const stripped = (keys as string[]).map((k: string) =>
            k.startsWith(this.config.keyPrefix) ? k.slice(this.config.keyPrefix.length) : k,
          );
          deleted += await this.client.del(...stripped);
        }
      }
    } catch {
      // graceful degradation
    }
    return deleted;
  }

  /** Get-or-set: returns cached value or computes and caches it. */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /** Multi-get: returns an array of values (null for misses). */
  async mget<T>(...keys: string[]): Promise<(T | null)[]> {
    if (!(await this.ensureConnected()) || !this.client) return keys.map(() => null);
    try {
      const results = await this.client.mget(...keys);
      return results.map((raw) => {
        if (!raw) return null;
        try {
          const entry: CacheEntry<T> = JSON.parse(raw);
          return entry.data;
        } catch {
          return null;
        }
      });
    } catch {
      return keys.map(() => null);
    }
  }

  /** Ping — returns true if connected and responsive. */
  async ping(): Promise<boolean> {
    if (!(await this.ensureConnected()) || !this.client) return false;
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /** Stats — returns basic cache stats. */
  async stats(): Promise<{ connected: boolean; keyCount?: number; memoryUsed?: string }> {
    if (!this.connected || !this.client) return { connected: false };
    try {
      const info = await this.client.info('memory');
      const memMatch = info.match(/used_memory_human:(.+)/);
      const keysInfo = await this.client.info('keyspace');
      const keysMatch = keysInfo.match(/keys=(\d+)/);
      return {
        connected: true,
        keyCount: keysMatch ? parseInt(keysMatch[1], 10) : undefined,
        memoryUsed: memMatch ? memMatch[1].trim() : undefined,
      };
    } catch {
      return { connected: this.connected };
    }
  }

  /** Graceful disconnect. */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
      this.connected = false;
      console.log('[RedisCache] Disconnected');
    }
  }
}

// ─── Singleton factory ──────────────────────────────────────────

let _instance: RedisCache | null = null;

/**
 * Get or create the singleton RedisCache instance.
 * Uses REDIS_HOST / REDIS_PORT env vars (defaults for GCP Memorystore).
 */
export function getRedisCache(): RedisCache {
  if (!_instance) {
    _instance = new RedisCache({
      host: process.env.REDIS_HOST ?? '10.0.0.3',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      tls: process.env.REDIS_TLS !== 'false',
      keyPrefix: process.env.REDIS_PREFIX ?? 'glyphor:',
    });
  }
  return _instance;
}
