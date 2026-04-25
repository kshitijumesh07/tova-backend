const prisma = require("./db");

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// Returns unique pickup zone names that have at least one open trip today
async function getPickupZones(date = new Date()) {
  const { start, end } = dayBounds(date);
  const routes = await prisma.route.findMany({
    where: {
      active: true,
      trips: {
        some: { status: "OPEN", seatsLeft: { gt: 0 }, tripDate: { gte: start, lte: end } },
      },
    },
    select: { fromName: true },
    distinct: ["fromName"],
    orderBy: { fromName: "asc" },
  });
  return routes.map((r) => r.fromName);
}

// Returns unique destination names for a given pickup zone with open trips today
async function getDestinationsFor(fromName, date = new Date()) {
  const { start, end } = dayBounds(date);
  const routes = await prisma.route.findMany({
    where: {
      active: true,
      fromName: { equals: fromName, mode: "insensitive" },
      trips: {
        some: { status: "OPEN", seatsLeft: { gt: 0 }, tripDate: { gte: start, lte: end } },
      },
    },
    select: { toName: true },
    distinct: ["toName"],
    orderBy: { toName: "asc" },
  });
  return routes.map((r) => r.toName);
}

// Returns all open trips for a specific route today, sorted by departure time
async function findTripsForRoute(fromName, toName, date = new Date()) {
  const { start, end } = dayBounds(date);
  const trips = await prisma.trip.findMany({
    where: {
      status: "OPEN",
      seatsLeft: { gt: 0 },
      tripDate: { gte: start, lte: end },
      route: {
        active: true,
        fromName: { equals: fromName.trim(), mode: "insensitive" },
        toName:   { equals: toName.trim(),   mode: "insensitive" },
      },
    },
    include: {
      route: true,
      host:  { select: { name: true } },
    },
    orderBy: { departureTime: "asc" },
  });

  return trips.map((t) => ({
    id:       t.id,
    time:     t.departureTime,
    price:    t.priceInr,
    seats:    t.seatsLeft,
    hostName: t.host.name,
    from:     t.route.fromName,
    to:       t.route.toName,
  }));
}

// Legacy: kept for any callers that pass free-text time
function parseTime(str) {
  const [time, period] = str.trim().split(" ");
  let [h, m] = time.split(":").map(Number);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + (m || 0);
}

async function matchRides(pickup, destination, time, date = new Date()) {
  const trips = await findTripsForRoute(pickup, destination, date);
  let requestedMin = 0;
  try { requestedMin = parseTime(time); } catch {}
  const nearby = trips.filter(
    (t) => Math.abs(parseTime(t.time) - requestedMin) <= 90
  );
  nearby.sort(
    (a, b) =>
      Math.abs(parseTime(a.time) - requestedMin) -
      Math.abs(parseTime(b.time) - requestedMin)
  );
  return nearby;
}

module.exports = { getPickupZones, getDestinationsFor, findTripsForRoute, matchRides };
