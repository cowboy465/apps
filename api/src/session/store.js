import Redis from "ioredis";

export class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  async create(session, ttlSec) {
    const expiresAt = Date.now() + ttlSec * 1000;
    this.sessions.set(session.id, { ...session, expiresAt });
    return this.sessions.get(session.id);
  }

  async get(sessionId) {
    const value = this.sessions.get(sessionId);
    if (!value) return null;
    if (Date.now() > value.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return value;
  }

  async update(sessionId, patch) {
    const existing = await this.get(sessionId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(sessionId, updated);
    return updated;
  }
}

export class RedisSessionStore {
  constructor(redisUrl) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async connect() {
    await this.redis.connect();
    return this;
  }

  key(sessionId) {
    return `realtime:session:${sessionId}`;
  }

  async create(session, ttlSec) {
    await this.redis.set(this.key(session.id), JSON.stringify(session), "EX", ttlSec);
    return session;
  }

  async get(sessionId) {
    const value = await this.redis.get(this.key(sessionId));
    return value ? JSON.parse(value) : null;
  }

  async update(sessionId, patch, ttlSec = null) {
    const existing = await this.get(sessionId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    const key = this.key(sessionId);
    const ttl = ttlSec ?? (await this.redis.ttl(key));
    if (ttl && ttl > 0) {
      await this.redis.set(key, JSON.stringify(updated), "EX", ttl);
    } else {
      await this.redis.set(key, JSON.stringify(updated));
    }
    return updated;
  }
}

export async function createSessionStore(redisUrl) {
  if (!redisUrl) return { type: "memory", store: new InMemorySessionStore() };

  try {
    const store = await new RedisSessionStore(redisUrl).connect();
    return { type: "redis", store };
  } catch (error) {
    console.warn("[session-store] Redis unavailable, using in-memory fallback:", error?.message);
    return { type: "memory", store: new InMemorySessionStore() };
  }
}
