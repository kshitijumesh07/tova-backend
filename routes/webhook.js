const express = require("express");
const crypto = require("crypto");
const { confirmBooking, failBooking, getBookingByOrderId, recordPayment } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

router.post("/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  if (!secret || !signature) {
    console.warn("Webhook: missing secret or signature — ignored");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  if (signature !== expected) {
    console.warn("Webhook: signature mismatch — ignored");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Bad body" }); }

  const entity = event?.payload?.payment?.entity || {};
  const order_id = entity.order_id;
  const payment_id = entity.id;
  const notes = entity.notes || {};
  const phone = notes.user_id || "";

  if (event.event === "payment.captured") {
    const result = await confirmBooking(order_id);
    if (result?.error) {
      console.warn("Webhook confirm failed:", result.error);
      notifyUser(phone, `Booking failed: ${result.error}.`);
      return res.status(200).json({ status: "rejected", reason: result.error });
    }
    await recordPayment(order_id, payment_id, entity.amount);
    console.log("BOOKING CONFIRMED via webhook:", order_id, "| user:", phone);
    await notifyUser(phone, `Your TOVA ride is confirmed! Order: ${order_id}. See you at the stop.`);

  } else if (event.event === "payment.failed") {
    await failBooking(order_id);
    console.log("PAYMENT FAILED:", order_id);
    await notifyUser(phone, `Payment failed for order ${order_id}. Please try again.`);
  }

  return res.status(200).json({ status: "ok" });
});

module.exports = router;
