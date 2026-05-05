const express    = require("express");
const prisma     = require("../services/db");
const { setOtp, getOtp, clearOtp, checkOtpRateLimit } = require("../services/session");
const { sendOtp } = require("../services/notify");

const router = express.Router();
const KEY    = (phone) => `auth:${phone}`;

// ── POST /auth/request-otp ────────────────────────────────────────────────────
// Universal — works for any phone, host or rider or new user

router.post("/request-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const testMode = process.env.OTP_TEST_MODE === "true";

  try {
    if (!testMode && !(await checkOtpRateLimit(phone))) {
      return res.status(429).json({ error: "Too many OTP requests. Try again in 10 minutes." });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await setOtp(KEY(phone), otp);
    await sendOtp(phone, otp);

    console.log("[auth] OTP sent to", phone, "| code:", otp);

    // In test mode, return OTP in response so login works without WhatsApp
    res.json({ sent: true, ...(testMode ? { otp } : {}) });
  } catch (err) {
    console.error("[auth] request-otp:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /auth/verify-otp ─────────────────────────────────────────────────────
// Verifies OTP and returns what kind of account(s) exist for this phone.
// Body: { phone, otp, name? }
// Response: { isHost, isRider, needsName?, hostData?, riderData? }

router.post("/verify-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  const otp   = (req.body.otp   || "").trim();
  const name  = (req.body.name  || "").trim();

  if (!phone || !otp) return res.status(400).json({ error: "phone and otp required" });

  try {
    const stored = await getOtp(KEY(phone));
    if (!stored || stored !== otp) {
      return res.status(401).json({ error: "Invalid or expired code. Request a new one." });
    }

    await clearOtp(KEY(phone));

    const [host, user] = await Promise.all([
      prisma.host.findUnique({ where: { phone }, select: { phone: true, name: true, vehicle: true } }),
      prisma.user.findUnique({ where: { phone }, select: { phone: true, name: true, deletedAt: true } }),
    ]);

    if (user?.deletedAt) {
      return res.status(403).json({ error: "This account has been deleted. Contact support on WhatsApp if this is an error." });
    }

    const isNew = !host && !user;

    // New user with no name — ask for it before creating account
    if (isNew && !name) {
      return res.json({ needsName: true });
    }

    // New user with name — create a User (rider) record
    let riderData = user ? { phone: user.phone, name: user.name || "" } : null;
    if (isNew && name) {
      const created = await prisma.user.create({
        data:   { phone, name },
        select: { phone: true, name: true },
      });
      riderData = { phone: created.phone, name: created.name || "" };
      console.log("[auth] new user registered:", phone, name);
    }

    console.log("[auth] verified:", phone, { isHost: !!host, isRider: !!user || isNew });
    res.json({
      isHost:    !!host,
      isRider:   !!user || (isNew && !!name),
      hostData:  host      ? { phone: host.phone, name: host.name, vehicle: host.vehicle } : null,
      riderData: riderData,
    });
  } catch (err) {
    console.error("[auth] verify-otp:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /auth/become-host ────────────────────────────────────────────────────
// Called after unified login when a rider wants to also become a host.
// Phone is already verified — no re-OTP needed.
// Body: { phone, vehicle, comfortSeats }

router.post("/become-host", async (req, res) => {
  const phone        = (req.body.phone        || "").replace(/^\+/, "");
  const vehicle      = (req.body.vehicle      || "").trim();
  const comfortSeats = parseInt(req.body.comfortSeats || 0);

  if (!phone || !vehicle || !comfortSeats) {
    return res.status(400).json({ error: "phone, vehicle, comfortSeats required" });
  }

  try {
    // Require a User record (must have done unified login first)
    const user = await prisma.user.findUnique({ where: { phone }, select: { name: true } });
    if (!user) return res.status(403).json({ error: "Please log in first." });

    // Idempotent — return existing host if already registered
    const existing = await prisma.host.findUnique({ where: { phone } });
    if (existing) {
      return res.json({ phone: existing.phone, name: existing.name, vehicle: existing.vehicle });
    }

    const host = await prisma.host.create({
      data: {
        phone,
        name:    user.name || "Host",
        vehicle: `${vehicle} (${comfortSeats} seats)`,
        active:  true,
      },
    });

    console.log("[auth] became host:", phone, host.name);
    res.json({ phone: host.phone, name: host.name, vehicle: host.vehicle });
  } catch (err) {
    console.error("[auth] become-host:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
