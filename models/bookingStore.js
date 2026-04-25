const prisma = require("../services/db");

async function createBooking(orderId, rideId, phone, capacity) {
  // upsert user so phone always exists in User table
  await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  await prisma.booking.create({
    data: { orderId, rideId, phone, capacity: capacity || 10, status: "CREATED" },
  });

  console.log("BOOKING CREATED:", orderId, "| ride:", rideId, "| user:", phone);
}

async function confirmBooking(orderId) {
  const booking = await prisma.booking.findUnique({ where: { orderId } });

  if (!booking) {
    console.warn("BOOKING NOT FOUND:", orderId);
    return { error: "Booking not found" };
  }

  if (booking.status === "CONFIRMED") {
    console.log("BOOKING already CONFIRMED:", orderId);
    return { success: true };
  }

  // count confirmed bookings for this ride (overbooking check)
  const taken = await prisma.booking.count({
    where: { rideId: booking.rideId, status: "CONFIRMED" },
  });

  if (taken >= booking.capacity) {
    await prisma.booking.update({ where: { orderId }, data: { status: "FAILED" } });
    console.warn("OVERBOOKING REJECTED:", booking.rideId);
    return { error: "No seats available" };
  }

  await prisma.booking.update({
    where: { orderId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  console.log("BOOKING CONFIRMED:", orderId, "| seat", taken + 1, "/", booking.capacity);
  return { success: true };
}

async function failBooking(orderId) {
  await prisma.booking.updateMany({
    where: { orderId, status: { not: "CONFIRMED" } },
    data: { status: "FAILED" },
  });
  console.log("BOOKING FAILED:", orderId);
}

async function recordPayment(orderId, razorpayPaymentId, amount) {
  const booking = await prisma.booking.findUnique({ where: { orderId } });
  if (!booking) return;

  await prisma.payment.upsert({
    where: { razorpayOrderId: orderId },
    update: { razorpayPaymentId, status: "CAPTURED" },
    create: {
      razorpayOrderId: orderId,
      razorpayPaymentId,
      bookingId: booking.id,
      amount: amount || booking.amount,
      status: "CAPTURED",
    },
  });
}

async function getBookings() {
  return prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    include: { payment: true },
  });
}

async function getBookingByOrderId(orderId) {
  return prisma.booking.findUnique({
    where: { orderId },
    include: { payment: true },
  });
}

module.exports = { createBooking, confirmBooking, failBooking, recordPayment, getBookings, getBookingByOrderId };
