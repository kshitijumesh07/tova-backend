const express = require("express");
const { getBookingByOrderId } = require("../models/bookingStore");

const router = express.Router();

router.get("/:order_id", async (req, res) => {
  const booking = await getBookingByOrderId(req.params.order_id);
  if (!booking) return res.status(404).json({ error: "Not found" });
  return res.json(booking);
});

module.exports = router;
