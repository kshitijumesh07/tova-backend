const express = require("express");
const { getBookings } = require("../models/bookingStore");
const { getDrivers, addDriver } = require("../models/driverStore");
const prisma = require("../services/db");

const router = express.Router();

router.get("/bookings", async (req, res) => {
  const bookings = await getBookings();
  res.json(bookings);
});

router.get("/drivers", (req, res) => {
  res.json(getDrivers());
});

router.get("/metrics", async (req, res) => {
  const [total, confirmed, failed, pending] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: { status: "CONFIRMED" } }),
    prisma.booking.count({ where: { status: "FAILED" } }),
    prisma.booking.count({ where: { status: "CREATED" } }),
  ]);

  const payments = await prisma.payment.aggregate({
    where: { status: "CAPTURED" },
    _sum: { amount: true },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = await prisma.booking.count({
    where: { status: "CONFIRMED", confirmedAt: { gte: todayStart } },
  });

  res.json({
    total,
    confirmed,
    failed,
    pending,
    revenue_paise: payments._sum.amount || 0,
    revenue_inr: Math.round((payments._sum.amount || 0) / 100),
    today_confirmed: todayCount,
    conversion_pct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
  });
});

router.post("/drivers/add", (req, res) => {
  const { id, name, phone, vehicle, route, time, seats } = req.body;
  if (!id || !name || !phone || !route || !time || !seats) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const result = addDriver({ id, name, phone, vehicle, route, time, seats: Number(seats) });
  if (result.error) return res.status(409).json(result);
  return res.json(result);
});

module.exports = router;
