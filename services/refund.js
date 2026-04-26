const Razorpay = require("razorpay");
const prisma   = require("./db");
const { notifyUser } = require("./notify");

function razorpay() {
  const key    = process.env.RAZORPAY_KEY;
  const secret = process.env.RAZORPAY_SECRET;
  if (!key || !secret) throw new Error("RAZORPAY_KEY / RAZORPAY_SECRET not set");
  return new Razorpay({ key_id: key, key_secret: secret });
}

function mode() {
  const k = process.env.RAZORPAY_KEY || "";
  return k.startsWith("rzp_test") ? "[TEST]" : k.startsWith("rzp_live") ? "[LIVE]" : "[UNKNOWN]";
}

// Process a single refund by Razorpay order ID.
// Returns { success, refundId, amountInr } or { error } or { skipped, reason }.
async function processRefund(orderId) {
  const payment = await prisma.payment.findUnique({
    where:   { razorpayOrderId: orderId },
    include: { booking: true },
  });

  if (!payment) return { error: "No payment record for " + orderId };
  if (payment.status === "REFUNDED") return { skipped: true, reason: "Already refunded" };

  if (!payment.razorpayPaymentId) {
    return { error: "No razorpayPaymentId — cannot refund (demo/test order?)" };
  }

  if (payment.status !== "CAPTURED") {
    return { error: `Payment status is ${payment.status}, expected CAPTURED` };
  }

  try {
    const rp     = razorpay();
    const refund = await rp.payments.refund(payment.razorpayPaymentId, {
      amount: payment.amount,
      speed:  "normal",
      notes:  { reason: "cancellation", order_id: orderId },
    });

    await prisma.$transaction([
      prisma.payment.update({
        where: { razorpayOrderId: orderId },
        data:  {
          razorpayRefundId: refund.id,
          status:           "REFUNDED",
          refundedAt:       new Date(),
        },
      }),
      prisma.booking.update({
        where: { orderId },
        data:  { status: "REFUNDED" },
      }),
    ]);

    // Notify rider
    notifyUser(
      payment.booking.phone,
      `Your TOVA refund of ₹${Math.round(payment.amount / 100)} has been processed and will reflect in your account within 5–7 business days.`,
    ).catch(() => {});

    console.log(`[refund] ${mode()} ok:`, orderId, "→", refund.id, `₹${Math.round(payment.amount / 100)}`);
    return { success: true, refundId: refund.id, amountInr: Math.round(payment.amount / 100) };

  } catch (err) {
    const msg = err?.error?.description || err?.message || "Refund API call failed";
    console.error(`[refund] ${mode()} failed:`, orderId, msg);
    return { error: msg };
  }
}

// Process all bookings in REFUND_PENDING state (up to 50 at a time).
async function processBatchRefunds() {
  const pending = await prisma.booking.findMany({
    where:   { status: "REFUND_PENDING" },
    include: { payment: true },
    take:    50,
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) return { processed: 0, results: [] };

  const results = [];
  for (const booking of pending) {
    if (!booking.payment) {
      results.push({ orderId: booking.orderId, skipped: true, reason: "No payment record" });
      continue;
    }
    const result = await processRefund(booking.orderId);
    results.push({ orderId: booking.orderId, ...result });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => r.error).length;
  console.log(`[refund] batch: ${succeeded} ok, ${failed} failed, ${pending.length - succeeded - failed} skipped`);
  return { processed: pending.length, succeeded, failed, results };
}

module.exports = { processRefund, processBatchRefunds };
