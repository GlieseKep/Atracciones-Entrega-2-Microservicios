import Redis from 'ioredis';

/** Caché de lecturas (read models, plan D6): Redis en despliegue y memoria en desarrollo y pruebas. */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(...keys: string[]): Promise<void>;
  /** Borra todas las claves que empiezan con el prefijo. */
  deletePrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: string; until: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.until <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value: JSON.stringify(value), until: Date.now() + ttlSeconds * 1000 });
  }

  async delete(...keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  async close(): Promise<void> {
    this.entries.clear();
  }
}

export class RedisCache implements Cache {
  private readonly redis: Redis;

  constructor(url: string, private readonly namespace = 'atracciones:') {
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.namespace + key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      // Una caché caída no debe tumbar la lectura: se consulta el servicio dueño del dato.
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.namespace + key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map((k) => this.namespace + k)).catch(() => undefined);
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${this.namespace}${prefix}*`, 'COUNT', 200);
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/** Redis si hay `REDIS_URL`; si no, memoria del proceso. */
export const createCache = (redisUrl: string | null | undefined): Cache => (redisUrl ? new RedisCache(redisUrl) : new MemoryCache());

/** Lee de la caché o calcula y guarda el valor. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await cache.set(key, value, ttlSeconds);
  return value;
}
