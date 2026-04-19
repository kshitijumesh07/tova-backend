const express = require("express");
const crypto = require("crypto");
const { confirmBooking, failBooking } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// Step 3: webhook = single source of truth for payment confirmation
router.post("/razorpay", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  if (!secret || !signature) {
    console.warn("Webhook: missing secret or signature — ignored");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("hex");

  if (signature !== expectedSignature) {
    console.warn("Webhook: signature mismatch — ignored");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    console.warn("Webhook: invalid JSON body — ignored");
    return res.status(400).json({ error: "Bad body" });
  }

  const eventType = event?.event;
  const notes = event?.payload?.payment?.entity?.notes || {};
  const { ride_id, user_id } = notes;
  const order_id = event?.payload?.payment?.entity?.order_id;

  if (eventType === "payment.captured") {
    const result = confirmBooking(order_id, user_id);
    if (result?.error) {
      console.warn("Webhook confirm failed:", result.error);
      notifyUser(user_id, `Booking failed: ${result.error}. Please contact support.`);
      return res.status(200).json({ status: "rejected", reason: result.error });
    }
    console.log("BOOKING CONFIRMED via webhook:", order_id, "| user:", user_id);
    // Step 4: structured WhatsApp confirmation
    notifyUser(user_id, `Your TOVA ride is confirmed! Order: ${order_id}. See you at the stop.`);

  } else if (eventType === "payment.failed") {
    failBooking(order_id, user_id);
    console.log("PAYMENT FAILED — booking marked FAILED:", order_id);
    notifyUser(user_id, `Payment failed for order ${order_id}. Please try again.`);

  } else {
    console.log("Webhook: unhandled event type:", eventType);
  }

  return res.status(200).json({ status: "ok" });
});

module.exports = router;
