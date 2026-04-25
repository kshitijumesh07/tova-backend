const Redis = require("ioredis");

const SESSION_TTL = 3600;
const KEY_PREFIX  = "tova:session:";

const fallback = {};
let redis = null;

function init() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[session] REDIS_URL not set — using in-memory sessions");
    return;
  }

  redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    connectTimeout:       8000,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });

  redis.on("connect", () => console.log("[session] Redis connected"));
  redis.on("error",   (err) => console.error("[session] Redis error:", err.message));
}

async function getSession(phone) {
  const key = KEY_PREFIX + phone;
  if (redis) {
    try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : { step: "START" };
    } catch (err) {
      console.error("[session] get failed, using fallback:", err.message);
    }
  }
  return fallback[key] ? JSON.parse(fallback[key]) : { step: "START" };
}

async function setSession(phone, session) {
  const key  = KEY_PREFIX + phone;
  const data = JSON.stringify(session);
  if (redis) {
    try {
      await redis.setex(key, SESSION_TTL, data);
      return;
    } catch (err) {
      console.error("[session] set failed, using fallback:", err.message);
    }
  }
  fallback[key] = data;
}

async function clearSession(phone) {
  const key = KEY_PREFIX + phone;
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch (err) {
      console.error("[session] del failed:", err.message);
    }
  }
  delete fallback[key];
}

init();

module.exports = { getSession, setSession, clearSession };
