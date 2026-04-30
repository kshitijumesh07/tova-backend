const express = require("express");
const { getPickupZones, getDestinationsFor, findTripsForRoute } = require("../services/matching");

const router = express.Router();

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

module.exports = router;
