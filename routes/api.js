const express      = require("express");
const prisma       = require("../services/db");
const { notifyUser } = require("../services/notify");
const { getPickupZones, getDestinationsFor, findTripsForRoute } = require("../services/matching");

const router = express.Router();

// GET /api/flags — public read so frontends can conditionally show/hide flag-gated UI
router.get("/flags", async (req, res) => {
  try {
    const flags = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
    const result = {};
    flags.forEach(f => { result[f.key] = f.enabled; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/routes — public, no auth — returns today's active routes for the landing page
router.get("/routes", async (req, res) => {
  try {
    const zones = await getPickupZones();
    const results = [];

    for (const from of zones) {
      const dests = await getDestinationsFor(from);
      for (const to of dests) {
        const trips = await findTripsForRoute(from, to);
        if (trips.length === 0) continue;

        const prices    = trips.map((t) => t.price);
        const seatsLeft = trips.reduce((s, t) => s + t.seats, 0);

        results.push({
          from,
          to,
          times:        trips.map((t) => t.time),
          priceMin:     Math.min(...prices),
          priceMax:     Math.max(...prices),
          seatsLeft,
          hasWomenOnly: trips.some((t) => t.rideMode === "WOMEN_ONLY"),
        });
      }
    }

    res.json(results);
  } catch (e) {
    console.error("[api/routes]", e.message);
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

// GET /api/trips?date=&fromName=&toName= — browse available trips for the PWA
router.get("/trips", async (req, res) => {
  try {
    const { date, fromName, toName } = req.query;
    const base = date ? new Date(date) : new Date();
    const start = new Date(base); start.setUTCHours(0, 0, 0, 0);
    const end   = new Date(base); end.setUTCHours(23, 59, 59, 999);

    // from can match route origin OR any intermediate stop
    const baseWhere = {
      status:    "OPEN",
      seatsLeft: { gt: 0 },
      tripDate:  { gte: start, lte: end },
    };
    if (fromName && toName) {
      baseWhere.OR = [
        { route: { fromName: { contains: fromName, mode: "insensitive" }, toName: { contains: toName, mode: "insensitive" } } },
        { stops: { some: { name: { contains: fromName, mode: "insensitive" } } }, route: { toName: { contains: toName, mode: "insensitive" } } },
      ];
    } else if (fromName) {
      baseWhere.OR = [
        { route: { fromName: { contains: fromName, mode: "insensitive" } } },
        { stops: { some: { name: { contains: fromName, mode: "insensitive" } } } },
      ];
    } else if (toName) {
      baseWhere.route = { toName: { contains: toName, mode: "insensitive" } };
    }

    const trips = await prisma.trip.findMany({
      where:   baseWhere,
      include: {
        route: { select: { fromName: true, toName: true } },
        host:  { select: { name: true, vehicle: true } },
        stops: { orderBy: { order: "asc" } },
      },
      orderBy: { departureTime: "asc" },
    });

    res.json(trips.map((t) => {
      const matchedStop = fromName
        ? t.stops.find(s => s.name.toLowerCase().includes(fromName.toLowerCase()) || fromName.toLowerCase().includes(s.name.toLowerCase()))
        : null;
      return {
        id:            t.id,
        from:          t.route.fromName,
        to:            t.route.toName,
        departureTime: t.departureTime,
        tripDate:      t.tripDate,
        priceInr:      t.priceInr,
        seatsLeft:     t.seatsLeft,
        totalSeats:    t.totalSeats,
        hostName:      t.host.name,
        hostVehicle:   t.host.vehicle,
        stops:         t.stops.map(s => ({ name: s.name, estimatedTime: s.estimatedTime, order: s.order })),
        pickupStop:    matchedStop ? { name: matchedStop.name, estimatedTime: matchedStop.estimatedTime } : null,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ride-request — rider registers demand when no trips found
// Body: { phone, fromName, toName, tripDate }
router.post("/ride-request", async (req, res) => {
  const phone    = (req.body.phone    || "").replace(/^\+/, "");
  const fromName = (req.body.fromName || "").trim();
  const toName   = (req.body.toName   || "").trim();
  const tripDate = (req.body.tripDate || "").trim();

  if (!phone || !fromName || !toName || !tripDate) {
    return res.status(400).json({ error: "phone, fromName, toName, tripDate required" });
  }

  try {
    // Deduplicate — one request per rider per route per date
    const existing = await prisma.rideRequest.findFirst({ where: { phone, fromName, toName, tripDate } });
    if (existing) return res.json({ ok: true, duplicate: true });

    await prisma.rideRequest.create({ data: { phone, fromName, toName, tripDate } });

    // Count unnotified requests for this route+date and nudge hosts if threshold reached
    const count = await prisma.rideRequest.count({ where: { fromName, toName, tripDate, notified: false } });
    if (count >= 3) {
      const pastHosts = await prisma.trip.findMany({
        where:    { route: { fromName, toName }, status: { in: ["OPEN", "COMPLETED"] } },
        include:  { host: { select: { phone: true, name: true } } },
        distinct: ["hostId"],
        take:     5,
      });

      const routeLabel = `${fromName} → ${toName}`;
      const adminPhone = process.env.ADMIN_PHONE || "917842957070";

      if (pastHosts.length > 0) {
        for (const t of pastHosts) {
          notifyUser(
            t.host.phone,
            `Hi ${t.host.name}! 🚗 ${count} riders are looking for a TOVA ride on *${routeLabel}* on ${tripDate}.\n\nPost a trip → gotova.in/host`,
          ).catch(() => {});
        }
      } else {
        // Brand-new route — alert admin to recruit a host
        notifyUser(
          adminPhone,
          `📍 *New route demand*\n\n${count} riders want *${routeLabel}* on ${tripDate}.\n\nNo host has run this route yet — recruit one or post a trip yourself.`,
        ).catch(() => {});
      }

      await prisma.rideRequest.updateMany({
        where: { fromName, toName, tripDate, notified: false },
        data:  { notified: true },
      });

      console.log(`[ride-request] ${pastHosts.length > 0 ? `nudged ${pastHosts.length} hosts` : "alerted admin (new route)"} for ${routeLabel} on ${tripDate} (${count} requests)`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[ride-request]", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
