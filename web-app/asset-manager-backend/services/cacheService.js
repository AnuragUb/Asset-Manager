const Redis = require('ioredis');

/**
 * Redis cache with logical DB separation:
 *   DB 0 (default) — Zoho / misc
 *   DB 1 (auth)    — RBAC + user snapshots
 *   DB 2 (product) — Product get/list responses
 *
 * Postgres remains source of truth. Never store passwords or JWT secrets here.
 * Never FLUSHALL — use flushDb / delPattern on the target namespace only.
 */

const memoryStores = new Map(); // dbIndex -> Map

let useMemoryFallback = !process.env.REDIS_HOST;
const clients = new Map(); // dbIndex -> Redis | null
let sharedFallback = false;

const DEFAULT_DB = parseInt(process.env.REDIS_DEFAULT_DB || '0', 10) || 0;
const AUTH_DB = parseInt(process.env.REDIS_AUTH_DB || '1', 10);
const PRODUCT_DB = parseInt(process.env.REDIS_PRODUCT_DB || '2', 10);

function memoryStoreFor(dbIndex) {
  if (!memoryStores.has(dbIndex)) memoryStores.set(dbIndex, new Map());
  return memoryStores.get(dbIndex);
}

function createClient(dbIndex) {
  if (!process.env.REDIS_HOST) return null;
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    db: dbIndex,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 3) {
        console.warn(`Redis DB ${dbIndex}: connection failed 3 times. Falling back to in-memory cache.`);
        sharedFallback = true;
        useMemoryFallback = true;
        return null;
      }
      return Math.min(times * 50, 2000);
    }
  });

  client.on('error', (err) => {
    if (!useMemoryFallback) {
      console.warn(`Redis DB ${dbIndex} error (will fallback to memory):`, err.message);
    }
  });

  client.connect().catch(() => {
    console.warn(`Redis DB ${dbIndex}: initial connection failed. Using in-memory fallback.`);
    useMemoryFallback = true;
    sharedFallback = true;
  });

  return client;
}

function getClient(dbIndex) {
  if (!clients.has(dbIndex)) {
    clients.set(dbIndex, createClient(dbIndex));
  }
  return clients.get(dbIndex);
}

function patternToNeedle(pattern) {
  return String(pattern || '').replace(/\*/g, '');
}

function matchesPattern(key, pattern) {
  const p = String(pattern || '');
  if (!p.includes('*')) return key === p;
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(key);
}

function createNamespace(dbIndex) {
  const api = {
    get: async (key) => {
      if (useMemoryFallback || sharedFallback || !getClient(dbIndex)) {
        const entry = memoryStoreFor(dbIndex).get(key);
        if (!entry) return null;
        if (entry.expiry && entry.expiry < Date.now()) {
          memoryStoreFor(dbIndex).delete(key);
          return null;
        }
        return entry.value;
      }
      try {
        const value = await getClient(dbIndex).get(key);
        return value ? JSON.parse(value) : null;
      } catch (err) {
        return null;
      }
    },

    set: async (key, value, ttl = 3600) => {
      if (useMemoryFallback || sharedFallback || !getClient(dbIndex)) {
        memoryStoreFor(dbIndex).set(key, {
          value,
          expiry: ttl ? Date.now() + ttl * 1000 : null
        });
        return;
      }
      try {
        const payload = JSON.stringify(value);
        if (ttl) {
          await getClient(dbIndex).set(key, payload, 'EX', ttl);
        } else {
          await getClient(dbIndex).set(key, payload);
        }
      } catch (err) {
        // ignore
      }
    },

    del: async (key) => {
      if (useMemoryFallback || sharedFallback || !getClient(dbIndex)) {
        memoryStoreFor(dbIndex).delete(key);
        return;
      }
      try {
        await getClient(dbIndex).del(key);
      } catch (err) {
        // ignore
      }
    },

    delPattern: async (pattern) => {
      if (useMemoryFallback || sharedFallback || !getClient(dbIndex)) {
        const store = memoryStoreFor(dbIndex);
        for (const key of store.keys()) {
          if (matchesPattern(key, pattern) || key.includes(patternToNeedle(pattern))) {
            store.delete(key);
          }
        }
        return;
      }
      try {
        const redis = getClient(dbIndex);
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (err) {
        // ignore
      }
    },

    /** Flush only this logical DB — never FLUSHALL. */
    flushDb: async () => {
      if (useMemoryFallback || sharedFallback || !getClient(dbIndex)) {
        memoryStoreFor(dbIndex).clear();
        return;
      }
      try {
        await getClient(dbIndex).flushdb();
      } catch (err) {
        // ignore
      }
    },

    dbIndex
  };
  return api;
}

const defaultNs = createNamespace(DEFAULT_DB);
const authNs = createNamespace(AUTH_DB);
const productNs = createNamespace(PRODUCT_DB);

// Backward-compatible root API = default DB (Zoho / misc).
const cache = {
  get: defaultNs.get,
  set: defaultNs.set,
  del: defaultNs.del,
  delPattern: defaultNs.delPattern,
  /** @deprecated Prefer flushDb on a specific namespace. Clears default DB only. */
  flush: defaultNs.flushDb,
  flushDb: defaultNs.flushDb,
  auth: authNs,
  product: productNs,
  default: defaultNs,
  AUTH_DB,
  PRODUCT_DB,
  DEFAULT_DB,
  isMemoryFallback: () => useMemoryFallback || sharedFallback
};

if (!process.env.REDIS_HOST) {
  console.log('No REDIS_HOST provided. Using in-memory cache (all namespaces).');
}

module.exports = cache;
