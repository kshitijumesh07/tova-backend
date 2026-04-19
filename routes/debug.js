const express = require("express");
const { getBookings } = require("../models/bookingStore");
const { getDrivers, addDriver } = require("../models/driverStore");

const router = express.Router();

router.get("/bookings", (req, res) => {
  res.json(getBookings());
});

router.get("/drivers", (req, res) => {
  res.json(getDrivers());
});

// Manual driver onboarding: POST /debug/drivers/add
router.post("/drivers/add", (req, res) => {
  const { id, name, phone, vehicle, route, time, seats } = req.body;
  if (!id || !name || !phone || !route || !time || !seats) {
    return res.status(400).json({ error: "Missing required fields: id, name, phone, route, time, seats" });
  }
  const result = addDriver({ id, name, phone, vehicle, route, time: String(time), seats: Number(seats) });
  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

module.exports = router;
