const express = require("express");
const Razorpay = require("razorpay");
const { createBooking } = require("../models/bookingStore");
const prisma = require("../services/db");

const router = express.Router();

router.post("/create", async (req, res) => {
  const key    = process.env.RAZORPAY_KEY;
  const secret = process.env.RAZORPAY_SECRET;
  if (!key || !secret) return res.status(500).json({ error: "ENV missing" });

  const { ride_id, user_id } = req.body;
  if (!ride_id || !user_id) return res.status(400).json({ error: "ride_id and user_id required" });

  // Normalize phone — strip leading + so it matches the WhatsApp session format
  const phone = user_id.replace(/^\+/, "");

  let trip;
  try {
    trip = await prisma.trip.findUnique({
      where: { id: ride_id },
      include: { route: true },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!trip) return res.status(404).json({ error: "Trip not found" });
  if (trip.status !== "OPEN" || trip.seatsLeft <= 0) {
    return res.status(409).json({ error: "No seats available for this trip" });
  }

  // Prevent hosts from booking their own trips
  const hostRecord = await prisma.host.findUnique({ where: { phone } });
  if (hostRecord && trip.hostId === hostRecord.id) {
    return res.status(403).json({ error: "Hosts cannot book their own trips." });
  }

  // Prevent duplicate bookings for the same trip
  const duplicate = await prisma.booking.findFirst({
    where: { phone, tripId: ride_id, status: { in: ["CREATED", "CONFIRMED"] } },
  });
  if (duplicate) {
    return res.status(409).json({ error: "You already have an active booking for this trip." });
  }

  const amountPaise = trip.priceInr * 100;

  try {
    const razorpay = new Razorpay({ key_id: key, key_secret: secret });
    const order = await razorpay.orders.create({
      amount:   amountPaise,
      currency: "INR",
      receipt:  "receipt_" + Date.now(),
      notes:    { ride_id, user_id },
    });

    await createBooking(order.id, ride_id, phone, trip.seatsLeft, ride_id);

    console.log("ORDER CREATED:", order.id, "| trip:", ride_id, "| user:", user_id);
    return res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    const message = err?.error?.description || err?.message || JSON.stringify(err);
    console.error("PAYMENT ERROR:", message);
    return res.status(500).json({ error: message });
  }
});

// ── POST /payment/demo ────────────────────────────────────────────────────────
// Creates a real Razorpay order for the demo checkout page (Razorpay reviewer flow)

router.post("/demo", async (req, res) => {
  const key    = process.env.RAZORPAY_KEY;
  const secret = process.env.RAZORPAY_SECRET;
  if (!key || !secret) return res.status(500).json({ error: "ENV missing" });

  const { name = "Demo User", phone = "919000000000" } = req.body;
  const cleanPhone = phone.replace(/^\+/, "");

  try {
    const razorpay = new Razorpay({ key_id: key, key_secret: secret });
    const order = await razorpay.orders.create({
      amount:   12900,
      currency: "INR",
      receipt:  "demo_" + Date.now(),
      notes:    { demo: "true", user_id: cleanPhone },
    });

    await prisma.user.upsert({
      where:  { phone: cleanPhone },
      update: {},
      create: { phone: cleanPhone, name },
    });

    await prisma.booking.create({
      data: {
        orderId:  order.id,
        rideId:   "demo",
        phone:    cleanPhone,
        capacity: 4,
        status:   "CREATED",
      },
    });

    res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    const msg = err?.error?.description || err?.message || "Order failed";
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
