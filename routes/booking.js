const express = require("express");
const { getBookings } = require("../models/bookingStore");

const router = express.Router();

router.get("/:order_id", (req, res) => {
  const booking = getBookings().find((b) => b.order_id === req.params.order_id);
  if (!booking) return res.status(404).json({ error: "Not found" });
  return res.json(booking);
});

module.exports = router;
