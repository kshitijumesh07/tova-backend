const prisma = require("../services/db");

async function createBooking(orderId, rideId, phone, capacity, tripId = null) {
  await prisma.user.upsert({
    where:  { phone },
    update: {},
    create: { phone },
  });

  await prisma.booking.create({
    data: {
      orderId,
      rideId,
      phone,
      capacity: capacity || 10,
      status:   "CREATED",
      ...(tripId ? { tripId } : {}),
    },
  });

  console.log("BOOKING CREATED:", orderId, "| trip:", tripId || rideId, "| user:", phone);
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

  if (booking.tripId) {
    // Atomic decrement — only succeeds if seatsLeft > 0
    const updated = await prisma.trip.updateMany({
      where: { id: booking.tripId, seatsLeft: { gt: 0 } },
      data:  { seatsLeft: { decrement: 1 } },
    });

    if (updated.count === 0) {
      await prisma.booking.update({ where: { orderId }, data: { status: "FAILED" } });
      console.warn("OVERBOOKING REJECTED:", booking.tripId);
      return { error: "No seats available" };
    }
  } else {
    // Legacy overbooking check for bookings without tripId
    const taken = await prisma.booking.count({
      where: { rideId: booking.rideId, status: "CONFIRMED" },
    });
    if (taken >= booking.capacity) {
      await prisma.booking.update({ where: { orderId }, data: { status: "FAILED" } });
      console.warn("OVERBOOKING REJECTED (legacy):", booking.rideId);
      return { error: "No seats available" };
    }
  }

  await prisma.booking.update({
    where: { orderId },
    data:  { status: "CONFIRMED", confirmedAt: new Date() },
  });

  console.log("BOOKING CONFIRMED:", orderId);
  return { success: true };
}

async function failBooking(orderId) {
  await prisma.booking.updateMany({
    where: { orderId, status: { not: "CONFIRMED" } },
    data:  { status: "FAILED" },
  });
  console.log("BOOKING FAILED:", orderId);
}

async function recordPayment(orderId, razorpayPaymentId, amount) {
  const booking = await prisma.booking.findUnique({ where: { orderId } });
  if (!booking) return;

  await prisma.payment.upsert({
    where:  { razorpayOrderId: orderId },
    update: { razorpayPaymentId, status: "CAPTURED" },
    create: {
      razorpayOrderId:   orderId,
      razorpayPaymentId,
      bookingId: booking.id,
      amount:    amount || booking.amount,
      status:    "CAPTURED",
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
    where:   { orderId },
    include: { payment: true, trip: { include: { route: true, host: true } } },
  });
}

async function getLatestConfirmedBooking(phone) {
  return prisma.booking.findFirst({
    where:   { phone, status: "CONFIRMED" },
    orderBy: { confirmedAt: "desc" },
    include: { trip: { include: { route: true } } },
  });
}

module.exports = { createBooking, confirmBooking, failBooking, recordPayment, getBookings, getBookingByOrderId, getLatestConfirmedBooking };
