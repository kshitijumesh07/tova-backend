const fs = require("fs");
const path = require("path");
const { reduceDriverSeat } = require("./driverStore");

const DB_PATH = path.resolve(__dirname, "../data/bookings.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { bookings: [], seatsTaken: {} };
  }
}

function save(db) {
  // ensure data/ directory exists (Railway ephemeral FS may not have it)
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function createBooking(order_id, ride_id, user_id, seats_available) {
  const db = load();
  db.bookings.push({
    order_id,
    ride_id,
    user_id,
    status: "CREATED",
    seats_available,
    created_at: new Date().toISOString(),
  });
  save(db);
  console.log("BOOKING CREATED:", order_id, "| ride:", ride_id, "| user:", user_id);
}

function confirmBooking(order_id, user_id) {
  const db = load();

  // look up by order_id only — order_id is unique, user_id from webhook notes may differ
  const booking = db.bookings.find((b) => b.order_id === order_id);

  if (!booking) {
    console.warn("BOOKING NOT FOUND:", order_id);
    return { error: "Booking not found" };
  }

  const taken = db.seatsTaken[booking.ride_id] || 0;
  if (taken >= booking.seats_available) {
    booking.status = "FAILED";
    save(db);
    console.warn("OVERBOOKING REJECTED:", booking.ride_id);
    return { error: "No seats available" };
  }

  db.seatsTaken[booking.ride_id] = taken + 1;
  booking.status = "CONFIRMED";
  booking.confirmed_at = new Date().toISOString();
  if (user_id) booking.confirmed_by = user_id;
  save(db);

  if (booking.driver_id) reduceDriverSeat(booking.driver_id);
  console.log("BOOKING CONFIRMED:", order_id, "| seat", taken + 1, "/", booking.seats_available);
  return { success: true };
}

function failBooking(order_id) {
  const db = load();
  const booking = db.bookings.find((b) => b.order_id === order_id);
  if (booking) {
    booking.status = "FAILED";
    save(db);
    console.log("BOOKING FAILED:", order_id);
  }
}

function updateRideStatus(order_id, status) {
  const db = load();
  const booking = db.bookings.find((b) => b.order_id === order_id);
  if (booking) {
    booking.status = status;
    save(db);
    console.log("RIDE STATUS UPDATED:", order_id, status);
  }
}

function getBookings() {
  return load().bookings;
}

module.exports = { createBooking, confirmBooking, failBooking, updateRideStatus, getBookings };
