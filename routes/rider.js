const express   = require("express");
const Razorpay  = require("razorpay");
const prisma    = require("../services/db");
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
          host:  { select: { name: true, vehicle: true, phone: true } },
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
    pickupStop:  b.pickup     || null,
    pickupTime:  b.pickupTime || null,
    trip: b.trip
      ? {
          tripDate:      b.trip.tripDate,
          departureTime: b.trip.departureTime,
          tripStatus:    b.trip.status,
          route: b.trip.route
            ? { fromName: b.trip.route.fromName, toName: b.trip.route.toName }
            : null,
          host: b.trip.host
            ? { name: b.trip.host.name, vehicle: b.trip.host.vehicle, phone: b.trip.host.phone }
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

// ── POST /rider/bookings/:bookingId/cancel ────────────────────────────────────
// Body: { phone }
// Calculates refund: >12 hrs before trip → 100%, ≤12 hrs → 50%
// Triggers Razorpay refund and sets booking to REFUND_PENDING.

router.post("/bookings/:bookingId/cancel", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const booking = await prisma.booking.findUnique({
    where:   { id: req.params.bookingId },
    include: {
      trip:    { include: { route: true, host: true } },
      payment: true,
    },
  });

  if (!booking)                    return res.status(404).json({ error: "Booking not found" });
  if (booking.phone !== phone)     return res.status(403).json({ error: "Not your booking" });
  if (booking.status !== "CONFIRMED") return res.status(409).json({ error: "Only confirmed bookings can be cancelled" });

  // Calculate refund % based on time until departure
  const now = new Date();
  let hoursUntilTrip = Infinity;
  if (booking.trip?.tripDate) {
    const [h = 0, m = 0] = (booking.trip.departureTime || "00:00").split(":").map(Number);
    const tripDateTime = new Date(booking.trip.tripDate);
    tripDateTime.setHours(h, m, 0, 0);
    hoursUntilTrip = (tripDateTime - now) / 36e5;
  }

  const refundPct    = hoursUntilTrip > 12 ? 100 : 50;
  const refundPaise  = Math.round(booking.amount * refundPct / 100);

  // Trigger Razorpay refund if payment has been captured
  if (booking.payment?.razorpayPaymentId) {
    try {
      const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY, key_secret: process.env.RAZORPAY_SECRET });
      await rz.payments.refund(booking.payment.razorpayPaymentId, {
        amount: refundPaise,
        notes:  { reason: "rider_cancelled", bookingId: booking.id },
      });
    } catch (err) {
      console.error("[rider] refund error:", err?.error?.description || err.message);
      return res.status(502).json({ error: "Could not initiate refund. Contact support on WhatsApp." });
    }
  }

  await prisma.$transaction([
    prisma.booking.update({ where: { id: booking.id }, data: { status: "REFUND_PENDING" } }),
    prisma.trip.update({ where: { id: booking.tripId }, data: { seatsLeft: { increment: 1 } } }),
  ]);

  // Notify host
  const route = booking.trip?.route;
  const host  = booking.trip?.host;
  if (host?.phone) {
    notifyUser(
      host.phone,
      `A rider cancelled their booking for your trip:\n` +
      `${route ? `${route.fromName} → ${route.toName}` : ""} · ${booking.trip.departureTime}\n` +
      `One seat is now available again.`,
    ).catch(() => {});
  }

  console.log(`[rider] booking cancelled: ${booking.id} | refund ${refundPct}% (₹${Math.round(refundPaise / 100)})`);
  res.json({ ok: true, refundPct, refundAmountInr: Math.round(refundPaise / 100) });
});

// ── DELETE /rider/account ─────────────────────────────────────────────────────
// Body: { phone }
// Checks for pending bookings/charges before allowing deletion.
// Soft-deletes: anonymises personal data, retains booking records for 3 years.

router.delete("/account", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.deletedAt) return res.status(410).json({ error: "Account already deleted" });

  // Check for upcoming confirmed bookings
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const pendingBookings = await prisma.booking.findMany({
    where: {
      phone,
      status: "CONFIRMED",
      trip: { tripDate: { gte: today } },
    },
    include: { trip: { include: { route: { select: { fromName: true, toName: true } } } } },
    take: 10,
  });

  if (pendingBookings.length > 0) {
    return res.status(409).json({
      error: "You have upcoming confirmed bookings. Please cancel them before deleting your account.",
      pendingBookings: pendingBookings.map(b => ({
        tripDate:      b.trip?.tripDate,
        route:         b.trip?.route ? `${b.trip.route.fromName} → ${b.trip.route.toName}` : "Unknown",
        departureTime: b.trip?.departureTime,
        amountInr:     Math.round(b.amount / 100),
      })),
    });
  }

  // Soft-delete: anonymise personal data, retain booking records
  await prisma.user.update({
    where: { phone },
    data: {
      name:              "Deleted User",
      govtIdType:        null,
      govtIdNumber:      null,
      govtDepartment:    null,
      govtRole:          null,
      verificationNotes: null,
      tags:              [],
      deletedAt:         new Date(),
    },
  });

  console.log("[rider] account deleted:", phone);
  res.json({ ok: true, message: "Account deleted. Your personal data has been removed." });
});

module.exports = router;
