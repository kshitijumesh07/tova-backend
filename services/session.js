const Redis = require("ioredis");

const SESSION_TTL = 3600; // 60 minutes
const KEY_PREFIX  = "tova:session:";

// In-memory fallback used when Redis is unavailable
const fallback = {};

let redis = null;

function init() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[session] REDIS_URL not set — falling back to in-memory sessions");
    return;
  }

  redis = new Redis(url, {
    lazyConnect:           true,
    maxRetriesPerRequest:  1,
    enableOfflineQueue:    false,
    connectTimeout:        5000,
  });

  redis.on("connect", () => console.log("[session] Redis connected"));
  redis.on("error",   (err) => console.error("[session] Redis error:", err.message));
}

function isRedisReady() {
  return redis && redis.status === "ready";
}

async function getSession(phone) {
  const key = KEY_PREFIX + phone;

  if (isRedisReady()) {
    try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : { step: "START" };
    } catch (err) {
      console.error("[session] get error:", err.message);
    }
  }

  return fallback[key] ? JSON.parse(fallback[key]) : { step: "START" };
}

async function setSession(phone, session) {
  const key  = KEY_PREFIX + phone;
  const data = JSON.stringify(session);

  if (isRedisReady()) {
    try {
      await redis.setex(key, SESSION_TTL, data);
      return;
    } catch (err) {
      console.error("[session] set error:", err.message);
    }
  }

  fallback[key] = data;
}

async function clearSession(phone) {
  const key = KEY_PREFIX + phone;

  if (isRedisReady()) {
    try {
      await redis.del(key);
      return;
    } catch (err) {
      console.error("[session] del error:", err.message);
    }
  }

  delete fallback[key];
}

init();

module.exports = { getSession, setSession, clearSession };
