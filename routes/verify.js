const express = require("express");
const crypto = require("crypto");
const { confirmBooking, getBookingByOrderId, recordPayment } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

router.post("/verify", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const secret = process.env.RAZORPAY_SECRET;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (expected !== razorpay_signature) {
    console.warn("Verify: HMAC mismatch for", razorpay_order_id, "— checking DB");
    const booking = await getBookingByOrderId(razorpay_order_id);
    if (booking?.status === "CONFIRMED") {
      console.log("Verify: already CONFIRMED via webhook, returning success");
      return res.json({ success: true });
    }
    return res.status(400).json({ success: false, reason: "signature_mismatch" });
  }

  const result = await confirmBooking(razorpay_order_id);
  if (result?.error) {
    console.warn("Verify confirm failed:", result.error);
    return res.status(409).json({ success: false, reason: result.error });
  }

  await recordPayment(razorpay_order_id, razorpay_payment_id, null);

  const booking = await getBookingByOrderId(razorpay_order_id);
  if (booking?.phone) {
    notifyUser(booking.phone, `Your TOVA ride is confirmed! Order: ${razorpay_order_id}`);
  }

  console.log("Payment verified:", razorpay_order_id);
  return res.json({ success: true });
});

module.exports = router;
