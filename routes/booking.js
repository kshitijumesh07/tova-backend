const express = require("express");
const prisma  = require("../services/db");
const { getBookingByOrderId } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// ── GET /booking/:order_id ────────────────────────────────────────────────────

router.get("/:order_id", async (req, res) => {
  const booking = await getBookingByOrderId(req.params.order_id);
  if (!booking) return res.status(404).json({ error: "Not found" });
  return res.json(booking);
});

// ── PATCH /booking/:order_id/cancel ──────────────────────────────────────────
// Rider cancels their own confirmed booking.
// Transitions: CONFIRMED → REFUND_PENDING

router.patch("/:order_id/cancel", async (req, res) => {
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!phone) return res.status(400).json({ error: "phone required" });

  const booking = await prisma.booking.findUnique({ where: { orderId: req.params.order_id } });
  if (!booking)               return res.status(404).json({ error: "Booking not found" });
  if (booking.phone !== phone) return res.status(403).json({ error: "Not your booking" });

  if (!["CREATED", "CONFIRMED"].includes(booking.status)) {
    return res.status(409).json({ error: `Cannot cancel a booking with status ${booking.status}` });
  }

  const nextStatus = booking.status === "CONFIRMED" ? "REFUND_PENDING" : "CANCELLED";

  const updated = await prisma.booking.update({
    where: { orderId: req.params.order_id },
    data:  { status: nextStatus },
  });

  if (nextStatus === "REFUND_PENDING") {
    notifyUser(
      phone,
      `Your TOVA booking cancellation has been received. Your refund of ₹${Math.round(booking.amount / 100)} will be processed within 48 hours.`,
    ).catch(() => {});
  }

  console.log("[booking] cancelled:", req.params.order_id, "→", nextStatus);
  res.json({ success: true, status: updated.status });
});

// ── PATCH /booking/:order_id/complete ────────────────────────────────────────
// Mark a confirmed booking as completed (called by admin/cron after trip date passes).
// Transitions: CONFIRMED → COMPLETED

router.patch("/:order_id/complete", async (req, res) => {
  const token = (req.headers["x-debug-token"] || "").trim();
  if (!token || token !== process.env.DEBUG_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const booking = await prisma.booking.findUnique({ where: { orderId: req.params.order_id } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  if (booking.status !== "CONFIRMED") {
    return res.status(409).json({ error: `Expected CONFIRMED, got ${booking.status}` });
  }

  const updated = await prisma.booking.update({
    where: { orderId: req.params.order_id },
    data:  { status: "COMPLETED" },
  });

  res.json({ success: true, status: updated.status });
});

module.exports = router;
