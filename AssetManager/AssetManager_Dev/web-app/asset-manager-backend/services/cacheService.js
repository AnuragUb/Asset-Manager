const Redis = require('ioredis');

// Simple in-memory fallback if Redis is unavailable
const memoryStore = new Map();

let redis = null;
let useMemoryFallback = false;

// Check if Redis config is provided
if (process.env.REDIS_HOST) {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 3) {
        console.warn('Redis connection failed 3 times. Falling back to in-memory cache.');
        useMemoryFallback = true;
        return null; // stop retrying
      }
      return Math.min(times * 50, 2000);
    }
  });

  redis.on('error', (err) => {
    // Only log if we haven't already switched to fallback
    if (!useMemoryFallback) {
      console.warn('Redis error (will fallback to memory):', err.message);
    }
  });

  redis.connect().catch(err => {
    console.warn('Initial Redis connection failed. Using in-memory fallback.');
    useMemoryFallback = true;
  });
} else {
  console.log('No REDIS_HOST provided. Using in-memory cache.');
  useMemoryFallback = true;
}

const cache = {
  get: async (key) => {
    if (useMemoryFallback || !redis) {
      const entry = memoryStore.get(key);
      if (!entry) return null;
      if (entry.expiry && entry.expiry < Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return entry.value;
    }
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      return null;
    }
  },
  
  set: async (key, value, ttl = 3600) => {
    if (useMemoryFallback || !redis) {
      memoryStore.set(key, {
        value,
        expiry: ttl ? (Date.now() + ttl * 1000) : null
      });
      return;
    }
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      // ignore
    }
  },
  
  del: async (key) => {
    if (useMemoryFallback || !redis) {
      memoryStore.delete(key);
      return;
    }
    try {
      await redis.del(key);
    } catch (err) {
      // ignore
    }
  },

  delPattern: async (pattern) => {
    if (useMemoryFallback || !redis) {
      for (const key of memoryStore.keys()) {
        if (key.includes(pattern.replace(/\*/g, ''))) {
          memoryStore.delete(key);
        }
      }
      return;
    }
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } catch (err) {
      // ignore
    }
  },
  
  flush: async () => {
    if (useMemoryFallback || !redis) {
      memoryStore.clear();
      return;
    }
    try {
      await redis.flushall();
    } catch (err) {
      // ignore
    }
  }
};

module.exports = cache;
