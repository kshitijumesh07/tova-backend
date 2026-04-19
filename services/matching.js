const { getAvailableDrivers } = require("../models/driverStore");

const ALLOWED_ROUTES = [
  { from: "sainikpuri", to: "hitech city" },
  { from: "hitech city", to: "sainikpuri" },
];

const ALLOWED_TIMES = ["8:00 AM", "6:00 PM"];

const RIDES = [
  { id: "1", from: "Sainikpuri", to: "Hitech City", time: "8:00 AM", km: 18 },
  { id: "2", from: "Sainikpuri", to: "Hitech City", time: "6:00 PM", km: 18 },
  { id: "3", from: "Hitech City", to: "Sainikpuri", time: "8:00 AM", km: 18 },
  { id: "4", from: "Hitech City", to: "Sainikpuri", time: "6:00 PM", km: 18 },
  { id: "5", from: "Sainikpuri", to: "Hitech City", time: "8:00 AM", km: 18 },
];

function calcPrice(km) {
  return Math.min(Math.max(km * 8, 40), 150);
}

function parseTime(str) {
  const [time, period] = str.trim().split(" ");
  let [h, m] = time.split(":").map(Number);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function matchRides(pickup, destination, time) {
  const fromKey = pickup.toLowerCase().trim();
  const toKey = destination.toLowerCase().trim();

  const routeAllowed = ALLOWED_ROUTES.some((r) => r.from === fromKey && r.to === toKey);
  if (!routeAllowed) return { error: "Route not available" };

  const requestedMin = parseTime(time);

  const matches = RIDES.filter((r) => {
    if (r.from.toLowerCase() !== fromKey) return false;
    if (r.to.toLowerCase() !== toKey) return false;
    if (!ALLOWED_TIMES.includes(r.time)) return false;
    if (Math.abs(parseTime(r.time) - requestedMin) > 30) return false;

    // only include ride if a driver exists for this slot
    const route = `${r.from}-${r.to}`;
    const drivers = getAvailableDrivers(route, r.time);
    return drivers.length > 0;
  });

  if (matches.length === 0) return [];

  matches.sort(
    (a, b) =>
      Math.abs(parseTime(a.time) - requestedMin) -
      Math.abs(parseTime(b.time) - requestedMin)
  );

  return matches.map((r) => {
    const route = `${r.from}-${r.to}`;
    const drivers = getAvailableDrivers(route, r.time);
    const seats = drivers.reduce((sum, d) => sum + d.seats, 0);
    return {
      id: r.id,
      time: r.time,
      price: calcPrice(r.km),
      seats,
      driver_id: drivers[0].id,
    };
  });
}

module.exports = { matchRides };
