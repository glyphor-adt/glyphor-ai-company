/**
 * Unit tests for RedisCache — tests the public API with a mocked ioredis client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisCache, CACHE_KEYS, CACHE_TTL } from '../redisCache.js';

// ─── Mock ioredis ───────────────────────────────────────────────
const mockRedisInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  mget: vi.fn(),
  ping: vi.fn().mockResolvedValue('PONG'),
  info: vi.fn(),
  scanStream: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => ({
  default: vi.fn(function () { return mockRedisInstance; }),
}));

// ─── Helpers ────────────────────────────────────────────────────
function makeEntry<T>(data: T, ttl = 300): string {
  return JSON.stringify({ data, cachedAt: Date.now(), ttl });
}

function createCache(overrides?: Partial<ConstructorParameters<typeof RedisCache>[0]>): RedisCache {
  return new RedisCache({
    host: '127.0.0.1',
    port: 6379,
    tls: false,
    keyPrefix: 'test:',
    defaultTtlSeconds: 300,
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CACHE_KEYS', () => {
  it('generates correct JIT key', () => {
    expect(CACHE_KEYS.jit('cto', 'abc123')).toBe('jit:cto:abc123');
  });

  it('generates correct reasoning config key', () => {
    expect(CACHE_KEYS.reasoningConfig('cfo')).toBe('reasoning-config:cfo');
  });

  it('generates correct wave key', () => {
    expect(CACHE_KEYS.wave(5)).toBe('wave:5');
  });

  it('generates correct directive key', () => {
    expect(CACHE_KEYS.directive('uuid-123')).toBe('directive:uuid-123');
  });
});

describe('CACHE_TTL', () => {
  it('has expected values', () => {
    expect(CACHE_TTL.jit).toBe(180);
    expect(CACHE_TTL.reasoning).toBe(120);
    expect(CACHE_TTL.reasoningConfig).toBe(600);
    expect(CACHE_TTL.wave).toBe(600);
  });
});

describe('RedisCache', () => {
  let cache: RedisCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = createCache();
  });

  describe('ensureConnected', () => {
    it('connects on first call and returns true', async () => {
      const result = await cache.ensureConnected();
      expect(result).toBe(true);
      expect(mockRedisInstance.connect).toHaveBeenCalledTimes(1);
    });

    it('does not reconnect if already connected', async () => {
      await cache.ensureConnected();
      await cache.ensureConnected();
      expect(mockRedisInstance.connect).toHaveBeenCalledTimes(1);
    });

    it('returns false when connection fails', async () => {
      mockRedisInstance.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const failCache = createCache();
      const result = await failCache.ensureConnected();
      expect(result).toBe(false);
    });
  });

  describe('get / set', () => {
    it('returns null on cache miss', async () => {
      mockRedisInstance.get.mockResolvedValue(null);
      const val = await cache.get('missing');
      expect(val).toBeNull();
    });

    it('returns deserialized data on hit', async () => {
      const payload = { name: 'Atlas', score: 42 };
      mockRedisInstance.get.mockResolvedValue(makeEntry(payload));
      const val = await cache.get('agent:atlas');
      expect(val).toEqual(payload);
    });

    it('set serializes and calls setex with TTL', async () => {
      await cache.set('k', { x: 1 }, 120);
      expect(mockRedisInstance.setex).toHaveBeenCalledWith('k', 120, expect.any(String));
      const stored = JSON.parse(mockRedisInstance.setex.mock.calls[0][2]);
      expect(stored.data).toEqual({ x: 1 });
      expect(stored.ttl).toBe(120);
    });

    it('set uses default TTL when none provided', async () => {
      await cache.set('k', 'v');
      expect(mockRedisInstance.setex).toHaveBeenCalledWith('k', 300, expect.any(String));
    });
  });

  describe('del', () => {
    it('deletes the key', async () => {
      await cache.del('old-key');
      expect(mockRedisInstance.del).toHaveBeenCalledWith('old-key');
    });
  });

  describe('getOrSet', () => {
    it('returns cached value without calling factory', async () => {
      mockRedisInstance.get.mockResolvedValue(makeEntry('cached-val'));
      const factory = vi.fn().mockResolvedValue('fresh-val');
      const result = await cache.getOrSet('k', factory, 60);
      expect(result).toBe('cached-val');
      expect(factory).not.toHaveBeenCalled();
    });

    it('calls factory and caches result on miss', async () => {
      mockRedisInstance.get.mockResolvedValue(null);
      const factory = vi.fn().mockResolvedValue('fresh-val');
      const result = await cache.getOrSet('k', factory, 60);
      expect(result).toBe('fresh-val');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.setex).toHaveBeenCalled();
    });
  });

  describe('mget', () => {
    it('returns array of values and nulls', async () => {
      mockRedisInstance.mget.mockResolvedValue([
        makeEntry('a'),
        null,
        makeEntry('c'),
      ]);
      const results = await cache.mget<string>('k1', 'k2', 'k3');
      expect(results).toEqual(['a', null, 'c']);
    });
  });

  describe('ping', () => {
    it('returns true on PONG', async () => {
      expect(await cache.ping()).toBe(true);
    });

    it('returns false on error', async () => {
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'));
      // need fresh cache since connection is already up
      expect(await cache.ping()).toBe(false);
    });
  });

  describe('stats', () => {
    it('parses memory and key count from INFO', async () => {
      await cache.ensureConnected();
      mockRedisInstance.info
        .mockResolvedValueOnce('used_memory_human:1.2M\r\n')
        .mockResolvedValueOnce('db0:keys=42,expires=10\r\n');
      const s = await cache.stats();
      expect(s.connected).toBe(true);
      expect(s.memoryUsed).toBe('1.2M');
      expect(s.keyCount).toBe(42);
    });
  });

  describe('invalidatePattern', () => {
    it('scans and deletes matching keys', async () => {
      const mockStream = {
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: ['test:reasoning:cto:1', 'test:reasoning:cto:2'] };
            },
          };
        },
      };
      mockRedisInstance.scanStream.mockReturnValue(mockStream);
      mockRedisInstance.del.mockResolvedValue(2);

      const count = await cache.invalidatePattern('reasoning:cto:*');
      expect(count).toBe(2);
      expect(mockRedisInstance.scanStream).toHaveBeenCalledWith(
        expect.objectContaining({ match: 'test:reasoning:cto:*' }),
      );
    });
  });

  describe('disconnect', () => {
    it('calls quit on the client', async () => {
      await cache.ensureConnected();
      await cache.disconnect();
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });
  });
});
