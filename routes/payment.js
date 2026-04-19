const express = require("express");
const Razorpay = require("razorpay");
const { createBooking } = require("../models/bookingStore");

const router = express.Router();

router.post("/create", async (req, res) => {
  const key = process.env.RAZORPAY_KEY;
  const secret = process.env.RAZORPAY_SECRET;

  if (!key || !secret) {
    return res.status(500).json({ error: "ENV missing: RAZORPAY_KEY or RAZORPAY_SECRET" });
  }

  const { ride_id, user_id, seats, amount } = req.body;

  try {
    const razorpay = new Razorpay({ key_id: key, key_secret: secret });

    const order = await razorpay.orders.create({
      amount: amount || 5000,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: { ride_id: ride_id || "", user_id: user_id || "" },
    });

    createBooking(order.id, ride_id, user_id, seats || 99);

    console.log("ORDER CREATED:", order.id, "| ride:", ride_id, "| user:", user_id);
    return res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    const message = err?.error?.description || err?.message || JSON.stringify(err);
    console.error("PAYMENT ERROR:", message);
    return res.status(500).json({ error: message });
  }
});

module.exports = router;
