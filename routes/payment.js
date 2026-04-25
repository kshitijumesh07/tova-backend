const express = require("express");
const Razorpay = require("razorpay");
const { createBooking } = require("../models/bookingStore");
const { getAvailableDrivers } = require("../models/driverStore");

const router = express.Router();

const RIDES = {
  "1": { from: "Sainikpuri", to: "Hitech City", time: "8:00 AM", amount: 5000 },
  "2": { from: "Sainikpuri", to: "Hitech City", time: "6:00 PM", amount: 6000 },
  "3": { from: "Hitech City", to: "Sainikpuri", time: "8:00 AM", amount: 5000 },
  "4": { from: "Hitech City", to: "Sainikpuri", time: "6:00 PM", amount: 6000 },
};

router.post("/create", async (req, res) => {
  const key = process.env.RAZORPAY_KEY;
  const secret = process.env.RAZORPAY_SECRET;

  if (!key || !secret) {
    return res.status(500).json({ error: "ENV missing: RAZORPAY_KEY or RAZORPAY_SECRET" });
  }

  const { ride_id, user_id, amount } = req.body;

  // Item 4: look up real seat count from drivers for this ride
  const ride = RIDES[ride_id];
  let seats = 99;
  if (ride) {
    const route = `${ride.from}-${ride.to}`;
    const drivers = getAvailableDrivers(route, ride.time);
    seats = drivers.reduce((sum, d) => sum + d.seats, 0);
    if (seats === 0) {
      return res.status(409).json({ error: "No seats available for this ride" });
    }
  }

  try {
    const razorpay = new Razorpay({ key_id: key, key_secret: secret });

    const order = await razorpay.orders.create({
      amount: amount || (ride?.amount) || 5000,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: { ride_id: ride_id || "", user_id: user_id || "" },
    });

    createBooking(order.id, ride_id, user_id, seats);

    console.log("ORDER CREATED:", order.id, "| ride:", ride_id, "| user:", user_id, "| seats available:", seats);
    return res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    const message = err?.error?.description || err?.message || JSON.stringify(err);
    console.error("PAYMENT ERROR:", message);
    return res.status(500).json({ error: message });
  }
});

module.exports = router;
