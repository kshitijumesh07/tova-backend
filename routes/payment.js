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

  const amountPaise = trip.priceInr * 100;

  try {
    const razorpay = new Razorpay({ key_id: key, key_secret: secret });
    const order = await razorpay.orders.create({
      amount:   amountPaise,
      currency: "INR",
      receipt:  "receipt_" + Date.now(),
      notes:    { ride_id, user_id },
    });

    await createBooking(order.id, ride_id, user_id, trip.seatsLeft, ride_id);

    console.log("ORDER CREATED:", order.id, "| trip:", ride_id, "| user:", user_id);
    return res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    const message = err?.error?.description || err?.message || JSON.stringify(err);
    console.error("PAYMENT ERROR:", message);
    return res.status(500).json({ error: message });
  }
});

module.exports = router;
