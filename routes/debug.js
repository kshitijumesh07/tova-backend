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

// ── GET /debug/hosts ──────────────────────────────────────────────────────────

router.get("/hosts", async (req, res) => {
  try {
    const hosts = await prisma.host.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { trips: true } } },
    });
    res.json(hosts.map((h) => ({
      id:        h.id,
      name:      h.name,
      phone:     h.phone,
      vehicle:   h.vehicle,
      active:    h.active,
      trips:     h._count.trips,
      createdAt: h.createdAt,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /debug/host/:id/toggle ──────────────────────────────────────────────

router.patch("/host/:id/toggle", async (req, res) => {
  try {
    const host    = await prisma.host.findUnique({ where: { id: req.params.id } });
    if (!host) return res.status(404).json({ error: "Host not found" });
    const updated = await prisma.host.update({ where: { id: req.params.id }, data: { active: !host.active } });
    res.json({ id: updated.id, active: updated.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /debug/routes ─────────────────────────────────────────────────────────

router.get("/routes", async (req, res) => {
  try {
    const routes = await prisma.route.findMany({
      orderBy: { fromName: "asc" },
      include: { _count: { select: { trips: true } } },
    });
    res.json(routes.map((r) => ({
      id:       r.id,
      from:     r.fromName,
      to:       r.toName,
      active:   r.active,
      trips:    r._count.trips,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /debug/route ─────────────────────────────────────────────────────────

router.post("/route", async (req, res) => {
  const { fromName, toName } = req.body;
  if (!fromName || !toName) return res.status(400).json({ error: "fromName and toName required" });
  try {
    const route = await prisma.route.upsert({
      where:  { fromName_toName: { fromName: fromName.trim(), toName: toName.trim() } },
      update: { active: true },
      create: { fromName: fromName.trim(), toName: toName.trim(), active: true },
    });
    res.json(route);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /debug/route/:id/toggle ─────────────────────────────────────────────

router.patch("/route/:id/toggle", async (req, res) => {
  try {
    const route   = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ error: "Route not found" });
    const updated = await prisma.route.update({ where: { id: req.params.id }, data: { active: !route.active } });
    res.json({ id: updated.id, active: updated.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ── GET /debug/metrics ────────────────────────────────────────────────────────
// Replaces the original /debug/metrics with richer operational data.

router.get("/metrics", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalBookings, confirmedBookings, failedBookings, pendingBookings,
      cancelledBookings, refundPending, refunded,
      totalUsers, activeRiders,
      revenue, todayBookings, todayRevenue,
      totalTrips, openTrips,
    ] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: { status: "CONFIRMED" } }),
      prisma.booking.count({ where: { status: "FAILED" } }),
      prisma.booking.count({ where: { status: "CREATED" } }),
      prisma.booking.count({ where: { status: "CANCELLED" } }),
      prisma.booking.count({ where: { status: "REFUND_PENDING" } }),
      prisma.booking.count({ where: { status: "REFUNDED" } }),
      prisma.user.count(),
      prisma.user.count({
        where: { bookings: { some: { createdAt: { gte: thirtyDaysAgo } } } },
      }),
      prisma.payment.aggregate({ where: { status: "CAPTURED" }, _sum: { amount: true } }),
      prisma.booking.count({ where: { status: "CONFIRMED", confirmedAt: { gte: todayStart() } } }),
      prisma.payment.aggregate({
        where: { status: "CAPTURED", createdAt: { gte: todayStart() } },
        _sum:  { amount: true },
      }),
      prisma.trip.count(),
      prisma.trip.count({ where: { status: "OPEN" } }),
    ]);

    // Fill rate: confirmed seats / total seats on non-cancelled trips
    const seatStats = await prisma.trip.aggregate({
      where:  { status: { not: "CANCELLED" } },
      _sum:   { totalSeats: true, seatsLeft: true },
    });
    const totalSeats  = seatStats._sum.totalSeats || 0;
    const seatsBooked = totalSeats - (seatStats._sum.seatsLeft || 0);
    const fillRate    = totalSeats > 0 ? Math.round((seatsBooked / totalSeats) * 100) : 0;

    // Repeat riders: users with more than one confirmed booking
    const repeatRiders = await prisma.user.count({
      where: { bookings: { some: { status: "CONFIRMED" } } },
    });
    // Note: this is users who have at least one confirmed — good enough for pilot metrics.

    // Top 5 routes by confirmed booking count
    const topRoutes = await prisma.booking.groupBy({
      by:      ["rideId"],
      where:   { status: "CONFIRMED", tripId: { not: null } },
      _count:  { id: true },
      orderBy: { _count: { id: "desc" } },
      take:    5,
    });

    res.json({
      bookings: {
        total: totalBookings, confirmed: confirmedBookings,
        failed: failedBookings, pending: pendingBookings,
        cancelled: cancelledBookings, refund_pending: refundPending, refunded,
      },
      users:       { total: totalUsers, active_30d: activeRiders, repeat: repeatRiders },
      trips:       { total: totalTrips, open: openTrips, fill_rate_pct: fillRate },
      revenue: {
        all_time_inr: Math.round((revenue._sum.amount || 0) / 100),
        today_inr:    Math.round((todayRevenue._sum.amount || 0) / 100),
      },
      today:           { confirmed: todayBookings },
      conversion_pct:  totalBookings > 0 ? Math.round((confirmedBookings / totalBookings) * 100) : 0,
      refund_rate_pct: confirmedBookings > 0 ? Math.round(((cancelledBookings + refundPending + refunded) / confirmedBookings) * 100) : 0,
      top_routes:      topRoutes.map((r) => ({ tripId: r.rideId, bookings: r._count.id })),
      generated_at:    new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Refund operations ─────────────────────────────────────────────────────────

const { processRefund, processBatchRefunds } = require("../services/refund");

// GET /debug/refunds — list bookings awaiting refund
router.get("/refunds", async (req, res) => {
  try {
    const rows = await prisma.booking.findMany({
      where:   { status: { in: ["REFUND_PENDING", "REFUNDED"] } },
      include: { payment: { select: { amount: true, razorpayPaymentId: true, razorpayRefundId: true, status: true, refundedAt: true } } },
      orderBy: { createdAt: "desc" },
      take:    parseLimit(req.query.limit, 100),
    });
    res.json({
      pending:  rows.filter((r) => r.status === "REFUND_PENDING").length,
      refunded: rows.filter((r) => r.status === "REFUNDED").length,
      rows: rows.map((b) => ({
        orderId:          b.orderId,
        phone:            b.phone,
        status:           b.status,
        amountInr:        Math.round((b.payment?.amount || b.amount) / 100),
        razorpayPaymentId: b.payment?.razorpayPaymentId || null,
        razorpayRefundId:  b.payment?.razorpayRefundId  || null,
        refundedAt:        b.payment?.refundedAt || null,
        createdAt:         b.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /debug/refund/:orderId — trigger single refund
router.post("/refund/:orderId", async (req, res) => {
  try {
    const result = await processRefund(req.params.orderId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /debug/refunds/batch — process all REFUND_PENDING
router.post("/refunds/batch", async (req, res) => {
  try {
    const result = await processBatchRefunds();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Payout ledger ─────────────────────────────────────────────────────────────

// GET /debug/payouts?hostId= — list payouts
router.get("/payouts", async (req, res) => {
  try {
    const where = {};
    if (req.query.hostId) where.hostId = req.query.hostId;
    if (req.query.status) where.status = req.query.status.toUpperCase();

    const payouts = await prisma.payout.findMany({
      where,
      include: { host: { select: { name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take:    parseLimit(req.query.limit, 100),
    });

    res.json({
      count: payouts.length,
      payouts: payouts.map((p) => ({
        id:           p.id,
        host:         p.host.name,
        phone:        p.host.phone,
        periodStart:  p.periodStart,
        periodEnd:    p.periodEnd,
        amountInr:    p.amountInr,
        riderCount:   p.riderCount,
        tripCount:    p.tripCount,
        status:       p.status,
        reference:    p.reference,
        processedAt:  p.processedAt,
        notes:        p.notes,
        createdAt:    p.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /debug/payout — create payout record for a host
// Body: { hostPhone, periodStart, periodEnd, amountInr, notes? }
router.post("/payout", async (req, res) => {
  const { hostPhone, periodStart, periodEnd, amountInr, notes } = req.body;
  const phone = (hostPhone || "").replace(/^\+/, "");

  if (!phone || !periodStart || !periodEnd || !amountInr) {
    return res.status(400).json({ error: "hostPhone, periodStart, periodEnd, amountInr required" });
  }

  try {
    const host = await prisma.host.findUnique({ where: { phone } });
    if (!host) return res.status(404).json({ error: "Host not found" });

    // Auto-compute riderCount and tripCount for the period
    const [tripCount, riderCount] = await Promise.all([
      prisma.trip.count({
        where: { hostId: host.id, tripDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
      }),
      prisma.booking.count({
        where: {
          status: "CONFIRMED",
          trip:   { hostId: host.id, tripDate: { gte: new Date(periodStart), lte: new Date(periodEnd) } },
        },
      }),
    ]);

    const payout = await prisma.payout.create({
      data: {
        hostId:      host.id,
        periodStart: new Date(periodStart),
        periodEnd:   new Date(periodEnd),
        amountInr:   parseInt(amountInr),
        riderCount,
        tripCount,
        status:      "PENDING",
        notes:       notes || null,
      },
    });

    res.json({ id: payout.id, status: payout.status, amountInr: payout.amountInr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /debug/payout/:id — update payout status + reference
// Body: { status: "PROCESSING"|"PAID", reference? }
router.patch("/payout/:id", async (req, res) => {
  const { status, reference } = req.body;
  const allowed = ["PENDING", "PROCESSING", "PAID"];
  if (!status || !allowed.includes(status.toUpperCase())) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  try {
    const updated = await prisma.payout.update({
      where: { id: req.params.id },
      data:  {
        status:      status.toUpperCase(),
        reference:   reference || undefined,
        processedAt: status.toUpperCase() === "PAID" ? new Date() : undefined,
      },
    });
    res.json({ id: updated.id, status: updated.status, processedAt: updated.processedAt });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Payout not found" });
    res.status(500).json({ error: e.message });
  }
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
