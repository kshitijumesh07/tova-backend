const express = require("express");
const crypto  = require("crypto");
const { confirmBooking, getBookingByOrderId, recordPayment } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

router.post("/verify", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const secret   = process.env.RAZORPAY_SECRET;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (expected !== razorpay_signature) {
    console.warn("Verify: HMAC mismatch for", razorpay_order_id);
    const booking = await getBookingByOrderId(razorpay_order_id);
    if (booking?.status === "CONFIRMED") return res.json({ success: true });
    return res.status(400).json({ success: false, reason: "signature_mismatch" });
  }

  const result = await confirmBooking(razorpay_order_id);
  if (result?.error) {
    console.warn("Verify confirm failed:", result.error);
    return res.status(409).json({ success: false, reason: result.error });
  }

  try {
    await recordPayment(razorpay_order_id, razorpay_payment_id, null);
  } catch (err) {
    console.error("[verify] recordPayment failed (non-fatal):", err.message);
  }

  const booking = await getBookingByOrderId(razorpay_order_id);
  console.log("[verify] booking.phone:", booking?.phone, "| tripId:", booking?.tripId);

  if (booking?.phone) {
    const route = booking.trip?.route;
    const line  = route
      ? `${route.fromName} → ${route.toName} | ${booking.trip.departureTime}`
      : razorpay_order_id;

    console.log("[verify] calling notifyUser to:", booking.phone);
    await notifyUser(booking.phone, `Booking confirmed!\n${line}\n\nSee you at the pickup stop. Type 'hi' to book another ride.`);
    console.log("[verify] notifyUser done");
  } else {
    console.warn("[verify] no phone on booking — notification skipped");
  }

  console.log("[verify] done:", razorpay_order_id);
  return res.json({ success: true });
});

module.exports = router;
