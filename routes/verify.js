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

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false });
  }

  // look up user_id from the booking (set at order creation)
  const booking = getBookings().find((b) => b.order_id === razorpay_order_id);
  const user_id = booking?.user_id || "unknown";

  const result = confirmBooking(razorpay_order_id, user_id);
  if (result?.error) {
    console.warn("Verify confirm failed:", result.error);
    return res.status(409).json({ success: false, reason: result.error });
  }

  console.log("Payment verified:", razorpay_order_id, "| user:", user_id);

  // Step 3: webhook is source of truth for prod; verify handles local dev
  // Step 4: structured notification
  notifyUser(user_id, `Your TOVA ride is confirmed! Order: ${razorpay_order_id}`);

  return res.json({ success: true });
});

module.exports = router;
