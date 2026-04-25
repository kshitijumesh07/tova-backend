const express    = require("express");
const prisma     = require("../services/db");
const { setOtp, getOtp, clearOtp } = require("../services/session");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// ── POST /host/request-otp ────────────────────────────────────────────────────

router.post("/request-otp", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

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

// ── GET /host/trips?phone=&date= ──────────────────────────────────────────────

router.get("/trips", async (req, res) => {
  const phone = (req.query.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  const dateParam = req.query.date ? new Date(req.query.date) : new Date();
  const { start, end } = dayBounds(dateParam);

  const trips = await prisma.trip.findMany({
    where:   { hostId: host.id, tripDate: { gte: start, lte: end } },
    include: {
      route:    { select: { fromName: true, toName: true } },
      bookings: {
        where:  { status: "CONFIRMED" },
        select: { id: true, phone: true },
      },
    },
    orderBy: { departureTime: "asc" },
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
    riders:        t.bookings.map((b) => ({ phone: b.phone })),
  }));

  res.json(result);
});

// ── POST /host/trip ───────────────────────────────────────────────────────────

router.post("/trip", async (req, res) => {
  const { hostPhone, routeId, departureTime, tripDate, totalSeats, totalCostInr } = req.body;
  const phone = (hostPhone || "").replace(/^\+/, "");

  if (!phone || !routeId || !departureTime || !tripDate || !totalSeats || !totalCostInr) {
    return res.status(400).json({ error: "All fields required: hostPhone, routeId, departureTime, tripDate, totalSeats, totalCostInr" });
  }

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) return res.status(404).json({ error: "Route not found" });

  const priceInr = Math.ceil(totalCostInr / totalSeats);

  const trip = await prisma.trip.create({
    data: {
      routeId,
      hostId:        host.id,
      departureTime: departureTime.trim(),
      tripDate:      new Date(tripDate),
      totalSeats:    parseInt(totalSeats),
      seatsLeft:     parseInt(totalSeats),
      priceInr,
      status:        "OPEN",
    },
    include: { route: { select: { fromName: true, toName: true } } },
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
  });
});

// ── PATCH /host/trip/:tripId/cancel ───────────────────────────────────────────

router.patch("/trip/:tripId/cancel", async (req, res) => {
  const phone = ((req.body.hostPhone || req.query.phone) || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "hostPhone required" });

  const host = await prisma.host.findUnique({ where: { phone } });
  if (!host) return res.status(404).json({ error: "Host not found" });

  const trip = await prisma.trip.findUnique({ where: { id: req.params.tripId } });
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  if (trip.hostId !== host.id) return res.status(403).json({ error: "Not your trip" });

  await prisma.trip.update({
    where: { id: req.params.tripId },
    data:  { status: "CANCELLED" },
  });

  res.json({ success: true });
});

module.exports = router;
