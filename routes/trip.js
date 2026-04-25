const express = require("express");
const prisma   = require("../services/db");

const router = express.Router();

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
