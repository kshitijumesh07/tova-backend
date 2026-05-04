const express = require("express");
const crypto  = require("crypto");
const prisma  = require("../services/db");
const { confirmBooking, failBooking, recordPayment, getBookingByOrderId } = require("../models/bookingStore");
const { notifyUser } = require("../services/notify");

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifySignature(body, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Claim the event slot atomically.
// Returns true if this process should handle the event, false if already seen.
async function claimEvent(razorpayId, event, orderId, paymentId, raw) {
  try {
    await prisma.webhookEvent.create({
      data: { razorpayId, event, orderId, paymentId, status: "PROCESSING", raw },
    });
    return true;
  } catch (e) {
    if (e.code === "P2002") return false; // unique violation = already claimed
    throw e;
  }
}

async function markEvent(razorpayId, status, error = null) {
  await prisma.webhookEvent.update({
    where: { razorpayId },
    data:  { status, error: error ? String(error).slice(0, 500) : null },
  }).catch(() => {}); // non-fatal
}

// ── POST /webhook/razorpay ────────────────────────────────────────────────────

router.post("/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  if (!secret || !signature) {
    console.warn("[webhook] missing secret or signature");
    return res.status(400).json({ error: "Invalid request" });
  }

  let signatureOk;
  try {
    signatureOk = verifySignature(req.body, signature, secret);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    console.warn("[webhook] signature mismatch");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Bad body" }); }

  const eventId   = event.id || `noid_${Date.now()}`;
  const eventType = event.event || "unknown";

  // Extract payment entity (present on payment.* and refund.* events)
  const paymentEntity = event?.payload?.payment?.entity || {};
  const refundEntity  = event?.payload?.refund?.entity  || {};
  const orderId   = paymentEntity.order_id  || refundEntity.order_id  || null;
  const paymentId = paymentEntity.id        || refundEntity.payment_id || null;

  // ── Idempotency gate ──────────────────────────────────────────────────────
  const claimed = await claimEvent(eventId, eventType, orderId, paymentId, req.body.toString());
  if (!claimed) {
    console.log(`[webhook] duplicate event ignored: ${eventId} (${eventType})`);
    return res.status(200).json({ status: "already_processed" });
  }

  console.log(`[webhook] processing: ${eventType} | order: ${orderId} | event: ${eventId}`);

  try {
    if (eventType === "payment.captured") {
      await handlePaymentCaptured({ event, orderId, paymentId, paymentEntity });

    } else if (eventType === "payment.failed") {
      await handlePaymentFailed({ orderId, paymentEntity });

    } else if (eventType === "refund.processed") {
      await handleRefundProcessed({ orderId, refundEntity });

    } else if (eventType === "refund.failed") {
      await handleRefundFailed({ orderId, refundEntity });

    } else {
      console.log(`[webhook] unhandled event type: ${eventType}`);
      await markEvent(eventId, "SKIPPED");
      return res.status(200).json({ status: "skipped", event: eventType });
    }

    await markEvent(eventId, "PROCESSED");
    return res.status(200).json({ status: "ok", event: eventType });

  } catch (err) {
    console.error(`[webhook] handler error for ${eventType}:`, err.message);
    await markEvent(eventId, "FAILED", err.message);
    // Still return 200 so Razorpay doesn't keep retrying an event we've logged
    return res.status(200).json({ status: "error_logged", event: eventType });
  }
});

// ── Event handlers ────────────────────────────────────────────────────────────

async function handlePaymentCaptured({ orderId, paymentId, paymentEntity }) {
  if (!orderId) throw new Error("payment.captured missing order_id");

  const phone = (paymentEntity.notes?.user_id || "").replace(/^\+/, "");

  // Check current status BEFORE confirming — used to determine if notification is needed
  const before = await getBookingByOrderId(orderId);
  const alreadyConfirmed = before?.status === "CONFIRMED";

  const result = await confirmBooking(orderId);

  if (result?.error) {
    // Overbooking or booking not found — notify rider and bail
    if (phone) {
      notifyUser(phone, `Your payment was received but the seat could not be confirmed (${result.error}). A refund will be issued within 48 hours.`).catch(() => {});
    }
    console.warn(`[webhook] confirm failed for ${orderId}:`, result.error);
    return;
  }

  // Record payment (upsert — safe to call multiple times)
  await recordPayment(orderId, paymentId, paymentEntity.amount).catch((e) => {
    console.error("[webhook] recordPayment non-fatal:", e.message);
  });

  // Only send WhatsApp notification on first confirmation — not on retries
  if (!alreadyConfirmed && phone) {
    const booking = await getBookingByOrderId(orderId);
    const route   = booking?.trip?.route;
    const line    = route
      ? `${route.fromName} → ${route.toName} at ${booking.trip.departureTime}`
      : `Order ${orderId}`;

    await notifyUser(
      phone,
      `✅ Booking confirmed!\n\n${line}\n\nSee you at the pickup point. Reply *hi* to book your next ride.`,
    );
    console.log(`[webhook] confirmed + notified: ${orderId} → ${phone}`);

    // Notify host
    const hostPhone = booking?.trip?.host?.phone;
    if (hostPhone) {
      const riderDisplay = phone ? `+${phone}` : "Unknown";
      notifyUser(
        hostPhone.replace(/^\+/, ""),
        `🚗 New booking!\n\nRider: ${riderDisplay}\nRoute: ${route?.fromName} → ${route?.toName}\nTime: ${booking.trip.departureTime}\nOrder: ${orderId}`,
      ).catch(() => {});
      console.log(`[webhook] host notified: ${hostPhone} for ${orderId}`);
    }
  } else if (alreadyConfirmed) {
    console.log(`[webhook] idempotent confirm (already CONFIRMED): ${orderId}`);
  }
}

async function handlePaymentFailed({ orderId, paymentEntity }) {
  if (!orderId) throw new Error("payment.failed missing order_id");

  const phone = (paymentEntity.notes?.user_id || "").replace(/^\+/, "");

  await failBooking(orderId);
  console.log(`[webhook] payment failed: ${orderId}`);

  if (phone) {
    await notifyUser(phone, `Payment failed for your TOVA booking. Please try again or contact support: https://wa.me/917842957070`);
  }
}

async function handleRefundProcessed({ orderId, refundEntity }) {
  if (!orderId) throw new Error("refund.processed missing order_id");

  const refundId = refundEntity.id;
  const amount   = refundEntity.amount;

  // Update payment + booking status
  await prisma.$transaction([
    prisma.payment.updateMany({
      where: { razorpayOrderId: orderId },
      data:  { razorpayRefundId: refundId, status: "REFUNDED", refundedAt: new Date() },
    }),
    prisma.booking.updateMany({
      where: { orderId, status: { in: ["REFUND_PENDING", "CONFIRMED"] } },
      data:  { status: "REFUNDED" },
    }),
  ]);

  // Notify rider
  const booking = await getBookingByOrderId(orderId);
  if (booking?.phone) {
    await notifyUser(
      booking.phone,
      `Your TOVA refund of ₹${Math.round((amount || 0) / 100)} has been processed and will reflect in your account within 5–7 business days.`,
    );
  }

  console.log(`[webhook] refund processed: ${orderId} → ${refundId}`);
}

async function handleRefundFailed({ orderId, refundEntity }) {
  if (!orderId) return;

  console.error(`[webhook] refund FAILED for ${orderId}:`, refundEntity?.id);

  // Keep status as REFUND_PENDING so admin can retry
  const booking = await getBookingByOrderId(orderId);
  if (booking?.phone) {
    notifyUser(
      booking.phone,
      `There was an issue processing your TOVA refund. Our team has been notified and will resolve it within 24 hours. Contact support: https://wa.me/917842957070`,
    ).catch(() => {});
  }
}

module.exports = router;
