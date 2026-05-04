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
  const name  = (req.body.name  || "").trim();
  if (!phone) return res.status(400).json({ error: "phone required" });

  try {
    if (!(await checkOtpRateLimit(phone))) {
      return res.status(429).json({ error: "Too many OTP requests. Try again in 10 minutes." });
    }

    const user = await prisma.user.findUnique({
      where:  { phone },
      select: { phone: true, name: true },
    });

    if (!user && !name) {
      return res.status(404).json({
        error: "No account found for this number. Enter your name to register, or book on WhatsApp first.",
        needsName: true,
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    // Store name alongside OTP for new-user registration
    await setOtp(rKey(phone), JSON.stringify({ otp, name: user ? (user.name || name) : name, isNew: !user }));
    await notifyUser(
      phone,
      `Your TOVA login code: *${otp}*\n\nValid for 5 minutes. Do not share this with anyone.`,
    );

    console.log("[rider] OTP sent to", phone, user ? "(existing)" : "(new registration)");
    res.json({ sent: true, isNew: !user });
  } catch (err) {
    console.error("[rider] request-otp error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── POST /rider/verify-otp ────────────────────────────────────────────────────

router.post("/verify-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  const otp   = (req.body.otp   || "").trim();

  if (!phone || !otp) return res.status(400).json({ error: "phone and otp required" });

  try {
    const raw = await getOtp(rKey(phone));
    if (!raw) return res.status(401).json({ error: "Invalid or expired code. Request a new one." });

    let session;
    try { session = JSON.parse(raw); } catch { session = { otp: raw }; }

    if (session.otp !== otp) {
      return res.status(401).json({ error: "Invalid or expired code. Request a new one." });
    }

    await clearOtp(rKey(phone));

    let user = await prisma.user.findUnique({ where: { phone }, select: { phone: true, name: true } });

    if (!user && session.isNew) {
      user = await prisma.user.create({
        data:   { phone, name: session.name || "" },
        select: { phone: true, name: true },
      });
      console.log("[rider] registered via PWA:", phone, session.name);
    } else if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    console.log("[rider] verified:", phone);
    res.json({ phone: user.phone, name: user.name || "" });
  } catch (err) {
    console.error("[rider] verify-otp error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── GET /rider/profile?phone= ─────────────────────────────────────────────────

router.get("/profile", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });
  try {
    const user = await prisma.user.findUnique({
      where:  { phone },
      select: { phone: true, name: true, gender: true, verificationStatus: true, govtRole: true, govtDepartment: true, tags: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json(user);
  } catch {
    // New columns may not exist yet on the DB — fall back to minimal fields
    const user = await prisma.user.findUnique({
      where:  { phone },
      select: { phone: true, name: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ ...user, verificationStatus: "UNVERIFIED", tags: [] });
  }
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
    tripId:      b.tripId,
    status:      b.status,
    amountInr:   Math.round(b.amount / 100),
    createdAt:   b.createdAt,
    confirmedAt: b.confirmedAt,
    trip: b.trip
      ? {
          tripDate:      b.trip.tripDate,
          departureTime: b.trip.departureTime,
          tripStatus:    b.trip.status,
          route: b.trip.route
            ? { fromName: b.trip.route.fromName, toName: b.trip.route.toName }
            : null,
        }
      : null,
  }));

  res.json(result);
});

// ── POST /rider/rebook ───────────────────────────────────────────────────────
// Given the rider's last confirmed booking's tripId, finds the next available
// trip on the same route with the same departure time.
// Returns trip details so the frontend can redirect directly to /checkout.

router.post("/rebook", async (req, res) => {
  const phone  = (req.body.phone  || "").replace(/^\+/, "");
  const tripId = (req.body.tripId || "").trim();
  if (!phone || !tripId) return res.status(400).json({ error: "phone and tripId required" });

  // Verify the booking belongs to this rider
  const booking = await prisma.booking.findFirst({
    where:   { phone, tripId, status: { in: ["CONFIRMED", "COMPLETED"] } },
    include: { trip: { include: { route: true } } },
  });
  if (!booking?.trip) {
    return res.status(404).json({ error: "No matching confirmed booking found." });
  }

  const { routeId, departureTime } = booking.trip;

  // Find the next available trip: same route, same departure time, future date, open seats
  const next = await prisma.trip.findFirst({
    where: {
      routeId,
      departureTime,
      status:    "OPEN",
      seatsLeft: { gt: 0 },
      tripDate:  { gt: new Date() },
    },
    orderBy: { tripDate: "asc" },
    include: { route: true },
  });

  if (!next) {
    return res.status(404).json({ error: "No upcoming trips on this route right now." });
  }

  console.log(`[rider] rebook: ${phone} → trip ${next.id} (${next.route.fromName} → ${next.route.toName})`);

  res.json({
    tripId:        next.id,
    departureTime: next.departureTime,
    tripDate:      next.tripDate,
    priceInr:      next.priceInr,
    seatsLeft:     next.seatsLeft,
    route: {
      fromName: next.route.fromName,
      toName:   next.route.toName,
    },
  });
});

module.exports = router;
