const express    = require("express");
const prisma     = require("../services/db");
const { setOtp, getOtp, clearOtp, checkOtpRateLimit } = require("../services/session");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// ── POST /host/register ───────────────────────────────────────────────────────
// Step 1: submit details + request OTP
// Step 2: verify OTP → host created

router.post("/register/request", async (req, res) => {
  const { name, vehicle, comfortSeats } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");

  if (!phone || !name || !vehicle || !comfortSeats) {
    return res.status(400).json({ error: "name, phone, vehicle, comfortSeats required" });
  }

  if (!(await checkOtpRateLimit(phone))) {
    return res.status(429).json({ error: "Too many OTP requests. Try again in 10 minutes." });
  }

  const existing = await prisma.host.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: "This number is already registered. Go to /host to log in." });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  // Store OTP along with pending registration data
  await setOtp(phone, JSON.stringify({ otp, name, vehicle, comfortSeats: parseInt(comfortSeats) }));
  await notifyUser(phone, `Your TOVA host registration code: *${otp}*\n\nValid for 5 minutes.`);

  console.log("[host] register OTP sent to", phone);
  res.json({ sent: true });
});

router.post("/register/verify", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  const otp   = (req.body.otp   || "").trim();

  if (!phone || !otp) return res.status(400).json({ error: "phone and otp required" });

  const raw = await getOtp(phone);
  if (!raw) return res.status(401).json({ error: "Code expired. Request a new one." });

  let pending;
  try { pending = JSON.parse(raw); } catch {
    return res.status(500).json({ error: "Invalid session. Start over." });
  }

  if (pending.otp !== otp) return res.status(401).json({ error: "Wrong code. Try again." });

  await clearOtp(phone);

  const existing = await prisma.host.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: "Already registered. Go to /host to log in." });
  }

  const host = await prisma.host.create({
    data: {
      phone,
      name:    pending.name,
      vehicle: `${pending.vehicle} (${pending.comfortSeats} seats)`,
      active:  true,
    },
  });

  console.log("[host] registered:", phone, pending.name);
  res.json({ id: host.id, name: host.name, phone: host.phone, vehicle: host.vehicle });
});

// ── POST /host/request-otp ────────────────────────────────────────────────────

router.post("/request-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  if (!(await checkOtpRateLimit(phone))) {
    return res.status(429).json({ error: "Too many OTP requests. Try again in 10 minutes." });
  }

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found. Contact TOVA to register." });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await setOtp(phone, otp);
  await notifyUser(phone, `Your TOVA host login code: *${otp}*\n\nValid for 5 minutes. Do not share this with anyone.`);

  console.log("[host] OTP sent to", phone);
  res.json({ sent: true });
});

// ── POST /host/verify-otp ─────────────────────────────────────────────────────

router.post("/verify-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  const otp   = (req.body.otp   || "").trim();

  if (!phone || !otp) return res.status(400).json({ error: "phone and otp required" });

  const stored = await getOtp(phone);
  if (!stored || stored !== otp) {
    return res.status(401).json({ error: "Invalid or expired code. Request a new one." });
  }

  await clearOtp(phone);

  const host = await prisma.host.findUnique({ where: { phone } });
  res.json({ id: host.id, name: host.name, phone: host.phone, vehicle: host.vehicle });
});

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// ── GET /host/me?phone= ───────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  res.json({ id: host.id, name: host.name, phone: host.phone, vehicle: host.vehicle });
});

// ── GET /host/routes ──────────────────────────────────────────────────────────

router.get("/routes", async (req, res) => {
  const routes = await prisma.route.findMany({
    where: { active: true },
    orderBy: { fromName: "asc" },
    select: { id: true, fromName: true, toName: true },
  });
  res.json(routes);
});

// ── GET /host/trips?phone=&date= (or ?upcoming=true for all future trips) ─────

router.get("/trips", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  let where;
  if (req.query.upcoming === "true") {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    where = { hostId: host.id, tripDate: { gte: todayStart } };
  } else {
    const dateParam = req.query.date ? new Date(req.query.date) : new Date();
    const { start, end } = dayBounds(dateParam);
    where = { hostId: host.id, tripDate: { gte: start, lte: end } };
  }

  const trips = await prisma.trip.findMany({
    where,
    include: {
      route:    { select: { fromName: true, toName: true } },
      stops:    { orderBy: { order: "asc" } },
      bookings: {
        where:  { status: "CONFIRMED" },
        select: { id: true, phone: true, pickup: true, pickupTime: true, user: { select: { name: true } } },
      },
    },
    orderBy: [{ tripDate: "asc" }, { departureTime: "asc" }],
  });

  const result = trips.map((t) => ({
    id:            t.id,
    from:          t.route.fromName,
    to:            t.route.toName,
    departureTime: t.departureTime,
    tripDate:      t.tripDate,
    totalSeats:    t.totalSeats,
    seatsLeft:     t.seatsLeft,
    booked:        t.bookings.length,
    priceInr:      t.priceInr,
    status:        t.status,
    stops:         t.stops.map(s => ({ name: s.name, estimatedTime: s.estimatedTime, order: s.order })),
    riders:        t.bookings.map((b) => ({ phone: b.phone, name: b.user?.name || "", pickupStop: b.pickup || null, pickupTime: b.pickupTime || null })),
  }));

  res.json(result);
});

// ── POST /host/trip ───────────────────────────────────────────────────────────

router.post("/trip", async (req, res) => {
  const { hostPhone, routeId, fromName, toName, departureTime, tripDate, totalSeats, totalCostInr, rideMode = "MIXED", stops = [] } = req.body;
  const phone = (hostPhone || "").replace(/^\+/, "");

  if (!phone || !departureTime || !tripDate || !totalSeats || !totalCostInr) {
    return res.status(400).json({ error: "hostPhone, departureTime, tripDate, totalSeats, totalCostInr required" });
  }
  if (!routeId && (!fromName || !toName)) {
    return res.status(400).json({ error: "Provide routeId or fromName+toName" });
  }

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  let route;
  if (routeId) {
    route = await prisma.route.findUnique({ where: { id: routeId } });
    if (!route) return res.status(404).json({ error: "Route not found" });
  } else {
    // Find existing route by name (case-insensitive) or create a new one
    const from = fromName.trim();
    const to   = toName.trim();
    route = await prisma.route.findFirst({
      where: {
        fromName: { equals: from, mode: "insensitive" },
        toName:   { equals: to,   mode: "insensitive" },
      },
    });
    if (!route) {
      route = await prisma.route.create({
        data: { fromName: from, toName: to, active: true },
      });
      console.log("[host/trip] created new route:", from, "→", to);
    }
  }

  const priceInr = Math.ceil(totalCostInr / totalSeats);

  const trip = await prisma.trip.create({
    data: {
      routeId:       route.id,
      hostId:        host.id,
      departureTime: departureTime.trim(),
      tripDate:      new Date(tripDate),
      totalSeats:    parseInt(totalSeats),
      seatsLeft:     parseInt(totalSeats),
      priceInr,
      status:        "OPEN",
      rideMode:      "MIXED",
      stops: stops.length > 0 ? {
        create: stops
          .filter(s => s.name && s.estimatedTime)
          .map((s, i) => ({ name: s.name.trim(), estimatedTime: s.estimatedTime.trim(), order: i + 1 })),
      } : undefined,
    },
    include: {
      route: { select: { fromName: true, toName: true } },
      stops: { orderBy: { order: "asc" } },
    },
  });

  res.json({
    id:            trip.id,
    from:          trip.route.fromName,
    to:            trip.route.toName,
    departureTime: trip.departureTime,
    tripDate:      trip.tripDate,
    totalSeats:    trip.totalSeats,
    priceInr:      trip.priceInr,
    status:        trip.status,
    stops:         trip.stops.map(s => ({ name: s.name, estimatedTime: s.estimatedTime, order: s.order })),
  });
});

// ── PATCH /host/trip/:tripId/cancel ───────────────────────────────────────────

router.patch("/trip/:tripId/cancel", async (req, res) => {
  const phone = ((req.body.hostPhone || req.query.phone) || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "hostPhone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  const trip = await prisma.trip.findUnique({
    where:   { id: req.params.tripId },
    include: {
      bookings: {
        where:   { status: "CONFIRMED" },
        include: { payment: true },
      },
    },
  });
  if (!trip)               return res.status(404).json({ error: "Trip not found" });
  if (trip.hostId !== host.id) return res.status(403).json({ error: "Not your trip" });

  await prisma.$transaction([
    prisma.trip.update({ where: { id: req.params.tripId }, data: { status: "CANCELLED" } }),
    prisma.booking.updateMany({ where: { tripId: req.params.tripId, status: "CONFIRMED" }, data: { status: "REFUND_PENDING" } }),
  ]);

  // Trigger Razorpay full refunds for all confirmed bookings
  const Razorpay = require("razorpay");
  const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY, key_secret: process.env.RAZORPAY_SECRET });

  for (const b of trip.bookings) {
    if (b.payment?.razorpayPaymentId) {
      rz.payments.refund(b.payment.razorpayPaymentId, {
        amount: b.amount,
        notes:  { reason: "host_cancelled_trip", tripId: trip.id },
      }).catch(err => console.error(`[host] refund failed for booking ${b.id}:`, err?.error?.description || err.message));
    }

    notifyUser(
      b.phone,
      `Your TOVA ride on ${trip.tripDate.toDateString()} has been cancelled by the host. ` +
      `A full refund of ₹${Math.round(b.amount / 100)} will be processed within 5–7 business days. Sorry for the inconvenience.\n\n` +
      `Contact support: https://wa.me/917842957070`,
    ).catch(() => {});
  }

  console.log("[host] trip cancelled:", req.params.tripId, "— affected riders:", trip.bookings.length);
  res.json({ success: true, affectedRiders: trip.bookings.length });
});

// ── GET /host/earnings?phone= ─────────────────────────────────────────────────

router.get("/earnings", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  const trips = await prisma.trip.findMany({
    where:   { hostId: host.id },
    include: {
      route:    { select: { fromName: true, toName: true } },
      bookings: {
        where:  { status: "CONFIRMED" },
        select: { id: true, amount: true, confirmedAt: true },
      },
    },
    orderBy: { tripDate: "desc" },
  });

  let totalPaise = 0;
  const breakdown = trips.map((t) => {
    const ridePaise = t.bookings.reduce((s, b) => s + b.amount, 0);
    totalPaise += ridePaise;
    return {
      tripId:        t.id,
      date:          t.tripDate,
      from:          t.route.fromName,
      to:            t.route.toName,
      departureTime: t.departureTime,
      riders:        t.bookings.length,
      revenueInr:    Math.round(ridePaise / 100),
      status:        t.status,
    };
  });

  const totalRiders = trips.reduce((s, t) => s + t.bookings.length, 0);

  res.json({
    totalRiders,
    totalRevenueInr:   Math.round(totalPaise / 100),
    platformFeeInr:    0,
    netEarningsInr:    Math.round(totalPaise / 100),
    pendingPayoutInr:  Math.round(totalPaise / 100),
    releasedPayoutInr: 0,
    trips: breakdown,
  });
});

module.exports = router;
