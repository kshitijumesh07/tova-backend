const express = require("express");
const crypto = require("crypto");
const { confirmBooking, getBookings } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

router.post("/verify", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const secret = process.env.RAZORPAY_SECRET;
  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  const signatureValid = expectedSignature === razorpay_signature;

  if (!signatureValid) {
    console.warn("Verify: HMAC mismatch for", razorpay_order_id, "— checking if webhook already confirmed");

    // Webhook may have already confirmed this booking — return success if so
    const booking = getBookings().find((b) => b.order_id === razorpay_order_id);
    if (booking?.status === "CONFIRMED") {
      console.log("Verify: booking already CONFIRMED via webhook, returning success");
      return res.json({ success: true });
    }

    return res.status(400).json({ success: false, reason: "signature_mismatch" });
  }

  const booking = getBookings().find((b) => b.order_id === razorpay_order_id);
  const user_id = booking?.user_id || "unknown";

  // only confirm if not already confirmed by webhook
  if (booking?.status !== "CONFIRMED") {
    const result = confirmBooking(razorpay_order_id, user_id);
    if (result?.error) {
      console.warn("Verify confirm failed:", result.error);
      return res.status(409).json({ success: false, reason: result.error });
    }
    notifyUser(user_id, `Your TOVA ride is confirmed! Order: ${razorpay_order_id}`);
  }

  console.log("Payment verified:", razorpay_order_id, "| user:", user_id);
  return res.json({ success: true });
});

module.exports = router;
