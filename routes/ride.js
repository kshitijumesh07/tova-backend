const express = require("express");
const prisma = require("../services/db");

const router = express.Router();

// POST /ride/search — list open trips for a route on a given date
router.post("/search", async (req, res) => {
  try {
    const { from, to, date } = req.body;

    const day = date ? new Date(date) : new Date();
    const dayStart = new Date(day); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd   = new Date(day); dayEnd.setUTCHours(23, 59, 59, 999);

    const where = {
      status:    "OPEN",
      seatsLeft: { gt: 0 },
      tripDate:  { gte: dayStart, lte: dayEnd },
    };

    if (from || to) {
      where.route = {};
      if (from) where.route.fromName = { equals: from, mode: "insensitive" };
      if (to)   where.route.toName   = { equals: to,   mode: "insensitive" };
    }

    const trips = await prisma.trip.findMany({
      where,
      orderBy: { departureTime: "asc" },
      include: { route: true, host: { select: { name: true, vehicle: true } } },
    });

    res.json(trips.map((t) => ({
      id:            t.id,
      from:          t.route.fromName,
      to:            t.route.toName,
      time:          t.departureTime,
      date:          t.tripDate,
      price:         t.priceInr,
      seatsLeft:     t.seatsLeft,
      totalSeats:    t.totalSeats,
      hostName:      t.host.name,
      hostVehicle:   t.host.vehicle,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ride/book — look up a specific trip by ID
router.post("/book", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { route: true, host: { select: { name: true, vehicle: true } } },
    });

    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (trip.status !== "OPEN" || trip.seatsLeft <= 0) {
      return res.status(409).json({ error: "No seats available" });
    }

    res.json({
      id:          trip.id,
      from:        trip.route.fromName,
      to:          trip.route.toName,
      time:        trip.departureTime,
      date:        trip.tripDate,
      price:       trip.priceInr,
      seatsLeft:   trip.seatsLeft,
      hostName:    trip.host.name,
      hostVehicle: trip.host.vehicle,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
