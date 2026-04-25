/**
 * Seed initial inventory: host, routes, and trips for the next 30 days.
 * Run once after `prisma db push`:
 *   node scripts/seed.js
 * Re-running is safe — upserts skip duplicates, trips are skipped if they already exist for that date.
 */

const prisma = require("../services/db");

const DAYS_AHEAD   = 30;
const PRICE_INR    = 129;
const TOTAL_SEATS  = 6;
const TIMES        = ["8:00 AM", "6:00 PM"];

const ROUTES = [
  { fromName: "Sainikpuri", toName: "Hitech City", distanceKm: 18 },
  { fromName: "Hitech City", toName: "Sainikpuri", distanceKm: 18 },
];

const HOST = {
  name:    "Ravi Kumar",
  phone:   "919000000001",
  vehicle: "Toyota Innova – TS09AB1234",
};

async function main() {
  // Host
  const host = await prisma.host.upsert({
    where:  { phone: HOST.phone },
    update: { name: HOST.name, vehicle: HOST.vehicle },
    create: HOST,
  });
  console.log("Host ready:", host.name);

  // Routes
  const routes = [];
  for (const r of ROUTES) {
    const route = await prisma.route.upsert({
      where:  { fromName_toName: { fromName: r.fromName, toName: r.toName } },
      update: { active: true },
      create: { ...r, active: true },
    });
    routes.push(route);
    console.log("Route ready:", route.fromName, "→", route.toName);
  }

  // Trips — one per route per time per day for the next DAYS_AHEAD days
  let created = 0;
  let skipped = 0;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let d = 0; d < DAYS_AHEAD; d++) {
    const tripDate = new Date(today.getTime() + d * 86400000);

    for (const route of routes) {
      for (const time of TIMES) {
        const existing = await prisma.trip.findFirst({
          where: {
            routeId:       route.id,
            hostId:        host.id,
            departureTime: time,
            tripDate:      tripDate,
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await prisma.trip.create({
          data: {
            routeId:       route.id,
            hostId:        host.id,
            departureTime: time,
            tripDate,
            totalSeats:    TOTAL_SEATS,
            seatsLeft:     TOTAL_SEATS,
            priceInr:      PRICE_INR,
            status:        "OPEN",
          },
        });
        created++;
      }
    }
  }

  console.log(`Trips created: ${created}, skipped (already exist): ${skipped}`);
  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
