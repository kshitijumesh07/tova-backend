/**
 * Debug / Ops endpoints
 * Protected by DEBUG_TOKEN env var (Bearer token or ?token= query param).
 * Set DEBUG_TOKEN in Railway backend variables.
 *
 * Routes:
 *   GET /debug/bookings   ?status=  ?today=1  ?limit=
 *   GET /debug/payments   ?status=  ?limit=
 *   GET /debug/users      ?limit=
 *   GET /debug/metrics
 *   GET /debug/latest
 */

const express = require("express");
const prisma  = require("../services/db");

const router = express.Router();

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireToken(req, res, next) {
  const secret = process.env.DEBUG_TOKEN;

  if (!secret) {
    // No token configured — open only in local dev; warn if looks like prod.
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "DEBUG_TOKEN not configured on server" });
    }
    return next();
  }

  const fromQuery  = req.query.token;
  const fromHeader = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided   = fromQuery || fromHeader;

  if (provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(requireToken);

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseLimit(q, def = 50) {
  const n = parseInt(q);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : def;
}

function fmtBooking(b) {
  return {
    id:            b.id,
    orderId:       b.orderId,
    userPhone:     b.phone,
    rideId:        b.rideId,
    status:        b.status,
    paymentStatus: b.payment ? b.payment.status : "NONE",
    amountInr:     b.payment ? b.payment.amount / 100 : b.amount / 100,
    createdAt:     b.createdAt,
    confirmedAt:   b.confirmedAt || null,
  };
}

function fmtPayment(p) {
  return {
    id:               p.id,
    razorpayOrderId:  p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    bookingPhone:     p.booking?.phone || null,
    amountInr:        p.amount / 100,
    status:           p.status,
    createdAt:        p.createdAt,
  };
}

function fmtUser(u) {
  return {
    id:           u.id,
    phone:        u.phone,
    name:         u.name || null,
    totalBookings: u._count?.bookings ?? 0,
    createdAt:    u.createdAt,
  };
}

// ── GET /debug/bookings ───────────────────────────────────────────────────────

router.get("/bookings", async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status.toUpperCase();
    if (req.query.today)  where.createdAt = { gte: todayStart() };

    const rows = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    parseLimit(req.query.limit),
      include: { payment: true },
    });

    res.json({ count: rows.length, bookings: rows.map(fmtBooking) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug/payments ───────────────────────────────────────────────────────

router.get("/payments", async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status.toUpperCase();

    const rows = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    parseLimit(req.query.limit),
      include: { booking: { select: { phone: true } } },
    });

    res.json({ count: rows.length, payments: rows.map(fmtPayment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug/users ──────────────────────────────────────────────────────────

router.get("/users", async (req, res) => {
  try {
    const rows = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take:    parseLimit(req.query.limit),
      include: { _count: { select: { bookings: true } } },
    });

    res.json({ count: rows.length, users: rows.map(fmtUser) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug/metrics ────────────────────────────────────────────────────────

router.get("/metrics", async (req, res) => {
  try {
    const [total, confirmed, failed, pending, totalUsers] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: { status: "CONFIRMED" } }),
      prisma.booking.count({ where: { status: "FAILED" } }),
      prisma.booking.count({ where: { status: "CREATED" } }),
      prisma.user.count(),
    ]);

    const [revenue, todayBookings, todayRevenue] = await Promise.all([
      prisma.payment.aggregate({ where: { status: "CAPTURED" }, _sum: { amount: true } }),
      prisma.booking.count({ where: { status: "CONFIRMED", confirmedAt: { gte: todayStart() } } }),
      prisma.payment.aggregate({
        where: { status: "CAPTURED", createdAt: { gte: todayStart() } },
        _sum:  { amount: true },
      }),
    ]);

    res.json({
      bookings: { total, confirmed, failed, pending },
      users:    { total: totalUsers },
      revenue:  {
        all_time_inr: Math.round((revenue._sum.amount || 0) / 100),
        today_inr:    Math.round((todayRevenue._sum.amount || 0) / 100),
      },
      today:    { confirmed: todayBookings },
      conversion_pct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug/latest ─────────────────────────────────────────────────────────

router.get("/latest", async (req, res) => {
  try {
    const [bookings, payments, users] = await Promise.all([
      prisma.booking.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { payment: true } }),
      prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { booking: { select: { phone: true } } } }),
      prisma.user.findMany({   orderBy: { createdAt: "desc" }, take: 5, include: { _count: { select: { bookings: true } } } }),
    ]);

    res.json({
      latest_bookings: bookings.map(fmtBooking),
      latest_payments: payments.map(fmtPayment),
      latest_users:    users.map(fmtUser),
      generated_at:    new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug/resend/:orderId — resend booking confirmation WhatsApp ─────────

router.get("/resend/:orderId", async (req, res) => {
  const prisma  = require("../services/db");
  const { notifyUser } = require("../services/notify");
  const booking = await prisma.booking.findUnique({
    where:   { orderId: req.params.orderId },
    include: { trip: { include: { route: true } } },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const route = booking.trip?.route;
  const line  = route
    ? `${route.fromName} → ${route.toName} | ${booking.trip.departureTime}`
    : booking.orderId;

  console.log("[resend] sending to:", booking.phone);
  await notifyUser(booking.phone, `Booking confirmed!\n${line}\n\nSee you at the pickup stop. Type 'hi' to book another ride.`);
  res.json({ sent: true, to: booking.phone, message: line });
});

// ── POST /debug/notify — test WhatsApp send ───────────────────────────────────
// Body: { phone: "919178...", message: "test" }

router.post("/notify", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone) return res.status(400).json({ error: "phone required" });

  const TOKEN    = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  if (!TOKEN || !PHONE_ID) {
    return res.status(500).json({ error: "WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set" });
  }

  const to   = phone.replace(/^\+/, "");
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message || "TOVA test notification" },
  });

  try {
    const result = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
      body,
    });
    const data = await result.json();
    res.json({ status: result.status, response: data, to });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
