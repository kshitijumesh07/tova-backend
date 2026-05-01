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

// ── OTP helpers ───────────────────────────────────────────────────────────────

const OTP_PREFIX = "tova:otp:";
const OTP_TTL    = 300; // 5 minutes

async function setOtp(phone, otp, ttl = OTP_TTL) {
  const key = OTP_PREFIX + phone;
  if (redis) {
    try { await redis.setex(key, ttl, otp); return; }
    catch (err) { console.error("[session] setOtp failed:", err.message); }
  }
  fallback[key] = otp;
  setTimeout(() => delete fallback[key], ttl * 1000);
}

async function getOtp(phone) {
  const key = OTP_PREFIX + phone;
  if (redis) {
    try { return await redis.get(key); }
    catch (err) { console.error("[session] getOtp failed:", err.message); }
  }
  return fallback[key] || null;
}

async function clearOtp(phone) {
  const key = OTP_PREFIX + phone;
  if (redis) {
    try { await redis.del(key); return; } catch {}
  }
  delete fallback[key];
}

// ── OTP rate limiting ─────────────────────────────────────────────────────────
// Max 3 OTP requests per phone per 10 minutes.

const RATE_PREFIX  = "tova:otp:rate:";
const RATE_WINDOW  = 600; // seconds
const RATE_LIMIT   = 3;
const rateLimiter  = {}; // in-memory fallback

async function checkOtpRateLimit(phone) {
  const key = RATE_PREFIX + phone;

  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, RATE_WINDOW);
      return count <= RATE_LIMIT;
    } catch (err) {
      console.error("[session] rate-limit check failed:", err.message);
      return true; // allow on Redis error
    }
  }

  const now = Date.now();
  const rec = rateLimiter[key];
  if (!rec || now > rec.expires) {
    rateLimiter[key] = { count: 1, expires: now + RATE_WINDOW * 1000 };
    return true;
  }
  rateLimiter[key].count++;
  return rateLimiter[key].count <= RATE_LIMIT;
}

module.exports = { getSession, setSession, clearSession, setOtp, getOtp, clearOtp, checkOtpRateLimit };
