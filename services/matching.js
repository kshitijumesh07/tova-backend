const prisma = require("./db");

function parseTime(str) {
  const [time, period] = str.trim().split(" ");
  let [h, m] = time.split(":").map(Number);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + (m || 0);
}

async function matchRides(pickup, destination, time, date = new Date()) {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const trips = await prisma.trip.findMany({
    where: {
      status: "OPEN",
      seatsLeft: { gt: 0 },
      tripDate: { gte: dayStart, lte: dayEnd },
      route: {
        fromName: { equals: pickup.trim(), mode: "insensitive" },
        toName:   { equals: destination.trim(), mode: "insensitive" },
        active: true,
      },
    },
    include: {
      route: true,
      host:  { select: { name: true } },
    },
  });

  let requestedMin = 0;
  try { requestedMin = parseTime(time); } catch {}

  const nearby = trips.filter(
    (t) => Math.abs(parseTime(t.departureTime) - requestedMin) <= 90
  );
  nearby.sort(
    (a, b) =>
      Math.abs(parseTime(a.departureTime) - requestedMin) -
      Math.abs(parseTime(b.departureTime) - requestedMin)
  );

  return nearby.map((t) => ({
    id:       t.id,
    time:     t.departureTime,
    price:    t.priceInr,
    seats:    t.seatsLeft,
    hostName: t.host.name,
    from:     t.route.fromName,
    to:       t.route.toName,
  }));
}

module.exports = { matchRides };
