/**
 * Admin routes — protected by DEBUG_TOKEN (same as /debug)
 * All routes require Authorization: Bearer <DEBUG_TOKEN>
 */

const express      = require("express");
const prisma       = require("../services/db");
const { notifyUser } = require("../services/notify");
const router       = express.Router();

// ── Auth (reuse same DEBUG_TOKEN) ─────────────────────────────────────────────

function requireToken(req, res, next) {
  const secret = process.env.DEBUG_TOKEN;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "DEBUG_TOKEN not configured" });
    }
    return next();
  }
  const fromQuery  = req.query.token;
  const fromHeader = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided   = fromQuery || fromHeader;
  if (provided !== secret) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.use(requireToken);

// ── Users ─────────────────────────────────────────────────────────────────────

router.get("/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        bookings: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 3,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/users/:id/verify", async (req, res) => {
  const { status, notes } = req.body;
  const allowed = ["UNVERIFIED", "PENDING", "APPROVED", "SUSPENDED"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { verificationStatus: status, ...(notes !== undefined ? { verificationNotes: notes } : {}) },
    });

    const messages = {
      APPROVED:  `✅ *You're verified on TOVA!*\n\nWelcome, ${user.name || "there"}. Your government employee status has been confirmed.\n\nType *hi* to book your first ride. 🚗`,
      SUSPENDED: `🚫 Your TOVA account has been suspended. If you think this is a mistake, contact us: https://wa.me/919390537737`,
      PENDING:   `⏳ Your TOVA verification is back under review. We'll notify you once a decision is made.`,
    };
    if (messages[status]) {
      notifyUser(user.phone, messages[status]).catch(() => {});
    }

    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/users/:id/profile", async (req, res) => {
  const { govtRole, govtDepartment, govtIdType, govtIdNumber, tags } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(govtRole        !== undefined ? { govtRole }        : {}),
        ...(govtDepartment  !== undefined ? { govtDepartment }  : {}),
        ...(govtIdType      !== undefined ? { govtIdType }      : {}),
        ...(govtIdNumber    !== undefined ? { govtIdNumber }    : {}),
        ...(tags            !== undefined ? { tags }            : {}),
      },
    });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/users/:id/bookings", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { phone: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    const bookings = await prisma.booking.findMany({
      where: { phone: user.phone },
      include: { trip: { include: { route: { select: { fromName: true, toName: true } } } }, payment: { select: { status: true, amount: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(bookings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/users/:id/flag", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { tags: true } });
    if (!user) return res.status(404).json({ error: "User not found" });
    const flagged = user.tags.includes("FLAGGED");
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { tags: flagged ? user.tags.filter(t => t !== "FLAGGED") : [...user.tags, "FLAGGED"] },
    });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trips (ride control) ──────────────────────────────────────────────────────

router.get("/trips", async (req, res) => {
  try {
    const trips = await prisma.trip.findMany({
      include: {
        route: { select: { fromName: true, toName: true } },
        host:  { select: { name: true, phone: true } },
        _count: { select: { bookings: { where: { status: "CONFIRMED" } } } },
      },
      orderBy: [{ tripDate: "desc" }, { departureTime: "asc" }],
      take: 200,
    });
    res.json(trips.map(t => ({
      id: t.id, from: t.route.fromName, to: t.route.toName,
      hostName: t.host.name, hostPhone: t.host.phone,
      departureTime: t.departureTime, tripDate: t.tripDate,
      totalSeats: t.totalSeats, seatsLeft: t.seatsLeft,
      status: t.status, rideMode: t.rideMode,
      confirmedRiders: t._count.bookings,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/trips/:id", async (req, res) => {
  const { status } = req.body;
  const allowed = ["OPEN", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const trip = await prisma.trip.update({ where: { id: req.params.id }, data: { status } });
    res.json(trip);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/trips/:id/assign", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });
  try {
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    await prisma.user.upsert({ where: { phone }, update: {}, create: { phone } });
    const orderId = `admin_${Date.now()}_${phone.slice(-4)}`;
    const booking = await prisma.$transaction([
      prisma.booking.create({
        data: { orderId, rideId: req.params.id, tripId: req.params.id, phone, status: "CONFIRMED", confirmedAt: new Date(), amount: 0 },
      }),
      prisma.trip.update({ where: { id: req.params.id }, data: { seatsLeft: { decrement: 1 } } }),
    ]);
    res.json({ ok: true, bookingId: booking[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/analytics", async (req, res) => {
  try {
    const dau = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end   = new Date(d); end.setHours(23, 59, 59, 999);
      const count = await prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } });
      dau.push({ date: start.toISOString().slice(0, 10), bookings: count });
    }
    const [unverified, pending, approved, suspended] = await Promise.all([
      prisma.user.count({ where: { verificationStatus: "UNVERIFIED" } }),
      prisma.user.count({ where: { verificationStatus: "PENDING" } }),
      prisma.user.count({ where: { verificationStatus: "APPROVED" } }),
      prisma.user.count({ where: { verificationStatus: "SUSPENDED" } }),
    ]);
    const repeatRiders = await prisma.user.count({
      where: { bookings: { some: { status: "CONFIRMED" } } },
    });
    const flaggedUsers = await prisma.user.count({
      where: { tags: { has: "FLAGGED" } },
    });
    const topRoutes = await prisma.booking.groupBy({
      by: ["rideId"], where: { status: "CONFIRMED", tripId: { not: null } },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 8,
    });
    res.json({
      dau,
      verificationFunnel: { unverified, pending, approved, suspended },
      repeatRiders,
      flaggedUsers,
      topRoutes: topRoutes.map(r => ({ tripId: r.rideId, bookings: r._count.id })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Zones ─────────────────────────────────────────────────────────────────────

router.get("/zones", async (req, res) => {
  try {
    const zones = await prisma.zone.findMany({ orderBy: [{ state: "asc" }, { district: "asc" }] });
    res.json(zones);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/zones", async (req, res) => {
  const { name, district, state, maxDensity, notes } = req.body;
  if (!name || !district) return res.status(400).json({ error: "name and district required" });
  try {
    const zone = await prisma.zone.create({
      data: { name, district, state: state || "Telangana", maxDensity: maxDensity || 0, notes },
    });
    res.json(zone);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/zones/:id", async (req, res) => {
  const { isActive, name, district, state, maxDensity, notes } = req.body;
  try {
    const zone = await prisma.zone.update({
      where: { id: req.params.id },
      data: {
        ...(isActive    !== undefined ? { isActive }    : {}),
        ...(name        !== undefined ? { name }        : {}),
        ...(district    !== undefined ? { district }    : {}),
        ...(state       !== undefined ? { state }       : {}),
        ...(maxDensity  !== undefined ? { maxDensity }  : {}),
        ...(notes       !== undefined ? { notes }       : {}),
      },
    });
    res.json(zone);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/zones/:id", async (req, res) => {
  try {
    await prisma.zone.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Feature Flags ─────────────────────────────────────────────────────────────

const DEFAULT_FLAGS = [
  { key: "otp_ride_start",      label: "OTP Ride Start",          description: "Require OTP from both parties before a ride begins",         category: "trust",    enabled: true  },
  { key: "live_tracking",       label: "Live Ride Tracking",       description: "Enable GPS tracking during active rides",                    category: "trust",    enabled: false },
  { key: "emergency_trigger",   label: "Emergency Trigger",        description: "Allow users to trigger an emergency alert mid-ride",         category: "safety",   enabled: false },
  { key: "invite_only",         label: "Invite-Only Onboarding",   description: "Block open registration — only invited users can join",      category: "access",   enabled: true  },
  { key: "host_open",           label: "Open Host Registration",   description: "Allow any verified user to register as a host",             category: "access",   enabled: true  },
  { key: "repeat_pairing_bias", label: "Repeat Pairing Bias",      description: "Prioritise previously paired users in matching logic",       category: "matching", enabled: true  },
  { key: "pwa_install_prompt",  label: "PWA Install Prompt",       description: "Show Add to Home Screen prompt to mobile visitors",         category: "pwa",      enabled: true  },
  { key: "women_only_rides",    label: "Women-Only Ride Mode",     description: "Allow hosts to create women-only trips (admin-controlled)", category: "safety",   enabled: false },
  { key: "whatsapp_bot_active", label: "WhatsApp Bot Active",      description: "Enable the WhatsApp booking bot entry point",               category: "access",   enabled: true  },
  { key: "manual_verification", label: "Manual Verification Mode", description: "Require admin approval before any user can book",           category: "access",   enabled: false },
];

router.get("/flags", async (req, res) => {
  try {
    // seed defaults on first call — upsert so existing values are preserved
    await Promise.all(DEFAULT_FLAGS.map(f =>
      prisma.featureFlag.upsert({
        where:  { key: f.key },
        update: {},
        create: f,
      })
    ));
    const flags = await prisma.featureFlag.findMany({
      orderBy: [{ category: "asc" }, { label: "asc" }],
    });
    res.json(flags);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/flags/:key", async (req, res) => {
  const { enabled, description } = req.body;
  try {
    const flag = await prisma.featureFlag.update({
      where: { key: req.params.key },
      data: {
        ...(enabled     !== undefined ? { enabled }     : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
    res.json(flag);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Future Possibilities ──────────────────────────────────────────────────────

const DEFAULT_FUTURE = [
  { phase: 1, title: "Private vehicle ride hosting (cars)",  description: "Peer-to-peer car ride hosting for verified govt employees on daily corridors",         status: "IN_PROGRESS", enabled: true  },
  { phase: 1, title: "WhatsApp booking bot",                 description: "Book rides via WhatsApp — no app download required",                                   status: "IN_PROGRESS", enabled: true  },
  { phase: 1, title: "Corridor-based matching",              description: "Match riders and hosts on fixed town-to-city corridors by time window",                 status: "IN_PROGRESS", enabled: true  },
  { phase: 1, title: "OTP ride confirmation",                description: "Both parties confirm the ride via OTP before departure",                               status: "PLANNED",     enabled: false },
  { phase: 1, title: "Repeat pairing priority",              description: "Match same users again on repeat bookings for trust density",                           status: "PLANNED",     enabled: false },
  { phase: 2, title: "Auto-rickshaw integration",            description: "3-seater shared autos on fixed pickup-point routes",                                   status: "PLANNED",     enabled: false },
  { phase: 2, title: "Bike ride sharing",                    description: "2-wheelers for shorter intra-district commute corridors",                              status: "PLANNED",     enabled: false },
  { phase: 2, title: "Pickup point clustering",              description: "Group riders at fixed pickup zones to reduce waiting and increase reliability",         status: "PLANNED",     enabled: false },
  { phase: 2, title: "Live ride tracking",                   description: "GPS tracking for active rides visible to rider",                                       status: "PLANNED",     enabled: false },
  { phase: 3, title: "Contracted fleet vehicles",            description: "Tata Winger / shared van operators for batch routing on high-demand corridors",        status: "PLANNED",     enabled: false },
  { phase: 3, title: "Admin fleet dispatch",                 description: "Admin-controlled fleet allocation and dispatch console",                               status: "PLANNED",     enabled: false },
  { phase: 3, title: "Emergency escalation system",          description: "In-ride emergency trigger with escalation to admin and emergency contacts",            status: "PLANNED",     enabled: false },
  { phase: 4, title: "School transport network",             description: "Parent + teacher tracked school bus alternative for private institutions",             status: "PLANNED",     enabled: false },
  { phase: 4, title: "Subscription commute pass",            description: "Monthly pass for daily riders — predictable cost, auto-renewal",                      status: "PLANNED",     enabled: false },
  { phase: 4, title: "Government shuttle services",          description: "Department-level shared shuttle for large government offices and campuses",            status: "PLANNED",     enabled: false },
  { phase: 4, title: "Private sector expansion",            description: "Open the verified network to private company employees after govt density is proven",  status: "PLANNED",     enabled: false },
];

router.get("/future", async (req, res) => {
  try {
    const count = await prisma.futurePossibility.count();
    if (count === 0) {
      await prisma.futurePossibility.createMany({ data: DEFAULT_FUTURE });
    }
    const items = await prisma.futurePossibility.findMany({
      orderBy: [{ phase: "asc" }, { createdAt: "asc" }],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/future", async (req, res) => {
  const { phase, title, description, notes } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const item = await prisma.futurePossibility.create({
      data: { phase: phase || 1, title, description, notes },
    });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/future/:id", async (req, res) => {
  const { enabled, status, notes, title, description, checklist } = req.body;
  try {
    const item = await prisma.futurePossibility.update({
      where: { id: req.params.id },
      data: {
        ...(enabled     !== undefined ? { enabled }                         : {}),
        ...(status      !== undefined ? { status }                          : {}),
        ...(notes       !== undefined ? { notes }                           : {}),
        ...(title       !== undefined ? { title }                           : {}),
        ...(description !== undefined ? { description }                     : {}),
        ...(checklist   !== undefined ? { checklist: JSON.stringify(checklist) } : {}),
      },
    });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/future/:id", async (req, res) => {
  try {
    await prisma.futurePossibility.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
