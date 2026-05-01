const express    = require("express");
const prisma     = require("../services/db");
const { notifyUser }                     = require("../services/notify");
const { setOtp: setKey, getOtp: getKey } = require("../services/session");

const router  = express.Router();
const LOC_KEY = (id) => `location:${id}`;

// ── GET /trip/:id/location — rider polls host position ────────────────────────
router.get("/:id/location", async (req, res) => {
  const raw = await getKey(LOC_KEY(req.params.id));
  if (!raw) return res.status(404).json({ error: "No location data yet." });
  try { res.json(JSON.parse(raw)); }
  catch { res.status(500).json({ error: "Invalid location data." }); }
});

// ── POST /trip/:id/location — host pushes position every ~30s ─────────────────
// Body: { phone, lat, lng }
router.post("/:id/location", async (req, res) => {
  const { lat, lng } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone || lat == null || lng == null) return res.status(400).json({ error: "phone, lat, lng required" });

  const flag = await prisma.featureFlag.findUnique({ where: { key: "live_tracking" } }).catch(() => null);
  if (!flag?.enabled) return res.status(403).json({ error: "Live tracking is not enabled." });

  const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: { host: { select: { phone: true } } } });
  if (!trip)                    return res.status(404).json({ error: "Trip not found." });
  if (trip.host.phone !== phone) return res.status(403).json({ error: "Only the host can push location." });

  await setKey(LOC_KEY(req.params.id), JSON.stringify({ lat: parseFloat(lat), lng: parseFloat(lng), updatedAt: new Date().toISOString() }), 900);
  res.json({ ok: true });
});

// ── POST /trip/:id/emergency — rider triggers SOS ────────────────────────────���
// Body: { phone }
router.post("/:id/emergency", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const flag = await prisma.featureFlag.findUnique({ where: { key: "emergency_trigger" } }).catch(() => null);
  if (!flag?.enabled) return res.status(403).json({ error: "Emergency trigger is not enabled." });

  const [trip, user] = await Promise.all([
    prisma.trip.findUnique({ where: { id: req.params.id }, include: { route: { select: { fromName: true, toName: true } }, host: { select: { phone: true, name: true } } } }),
    prisma.user.findUnique({ where: { phone }, select: { name: true } }),
  ]);

  const routeLabel = trip?.route ? `${trip.route.fromName} → ${trip.route.toName}` : req.params.id;
  const adminPhone = process.env.ADMIN_PHONE || "919390537737";

  await notifyUser(adminPhone,
    `🆘 *EMERGENCY ALERT*\n\nRider: ${user?.name || "Unknown"} (+${phone})\nTrip: ${routeLabel}\nHost: ${trip?.host?.name || "Unknown"} (+${trip?.host?.phone || "Unknown"})\n\nImmediate attention required.`,
  );
  if (trip?.host?.phone) {
    notifyUser(trip.host.phone, `🆘 *Emergency alert* from your rider on trip ${routeLabel}. Please check on them immediately.`).catch(() => {});
  }

  console.log("[emergency] triggered by:", phone, "trip:", req.params.id);
  res.json({ sent: true });
});

router.get("/:id", async (req, res) => {
  try {
    const trip = await prisma.trip.findUnique({
      where:   { id: req.params.id },
      include: {
        route: true,
        host:  { select: { name: true, vehicle: true } },
      },
    });

    if (!trip) return res.status(404).json({ error: "Trip not found" });

    res.json({
      id:           trip.id,
      from:         trip.route.fromName,
      to:           trip.route.toName,
      departureTime: trip.departureTime,
      tripDate:     trip.tripDate,
      price:        trip.priceInr,
      seatsLeft:    trip.seatsLeft,
      totalSeats:   trip.totalSeats,
      status:       trip.status,
      hostName:     trip.host.name,
      hostVehicle:  trip.host.vehicle,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
