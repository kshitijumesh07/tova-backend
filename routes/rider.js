const express  = require("express");
const prisma   = require("../services/db");
const { setOtp, getOtp, clearOtp, checkOtpRateLimit } = require("../services/session");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// Rider OTP keys are namespaced separately from host OTP keys
const rKey = (phone) => `rider:${phone}`;

// ── POST /rider/request-otp ───────────────────────────────────────────────────

router.post("/request-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  if (!(await checkOtpRateLimit(phone))) {
    return res.status(429).json({ error: "Too many OTP requests. Try again in 10 minutes." });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    return res.status(404).json({
      error: "No account found for this number. Book a ride on WhatsApp first.",
    });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await setOtp(rKey(phone), otp);
  await notifyUser(
    phone,
    `Your TOVA login code: *${otp}*\n\nValid for 5 minutes. Do not share this with anyone.`,
  );

  console.log("[rider] OTP sent to", phone);
  res.json({ sent: true });
});

// ── POST /rider/verify-otp ────────────────────────────────────────────────────

router.post("/verify-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  const otp   = (req.body.otp   || "").trim();

  if (!phone || !otp) return res.status(400).json({ error: "phone and otp required" });

  const stored = await getOtp(rKey(phone));
  if (!stored || stored !== otp) {
    return res.status(401).json({ error: "Invalid or expired code. Request a new one." });
  }

  await clearOtp(rKey(phone));

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: "User not found." });

  console.log("[rider] verified:", phone);
  res.json({ phone: user.phone, name: user.name || "" });
});

// ── GET /rider/bookings?phone= ────────────────────────────────────────────────

router.get("/bookings", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const bookings = await prisma.booking.findMany({
    where: { phone },
    include: {
      trip: {
        include: {
          route: { select: { fromName: true, toName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const result = bookings.map((b) => ({
    id:          b.id,
    orderId:     b.orderId,
    status:      b.status,
    amountInr:   Math.round(b.amount / 100),
    createdAt:   b.createdAt,
    confirmedAt: b.confirmedAt,
    trip: b.trip
      ? {
          tripDate:      b.trip.tripDate,
          departureTime: b.trip.departureTime,
          route: b.trip.route
            ? { fromName: b.trip.route.fromName, toName: b.trip.route.toName }
            : null,
        }
      : null,
  }));

  res.json(result);
});

module.exports = router;
