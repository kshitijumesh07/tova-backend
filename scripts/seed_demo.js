const { Client } = require("pg");

const DB_URL = process.argv[2];
if (!DB_URL) { console.error("Usage: node scripts/seed_demo.js <DATABASE_URL>"); process.exit(1); }

// All demo records are tagged with [DEMO] in name and use fake phone numbers
// Run cleanup_demo.js to remove them

const DEMO_HOSTS = [
  { name: "[DEMO] Priya Sharma",  phone: "910000000001", vehicle: "Maruti Suzuki Swift (White)" },
  { name: "[DEMO] Ravi Kumar",    phone: "910000000002", vehicle: "Honda City (Silver)" },
  { name: "[DEMO] Ananya Reddy",  phone: "910000000003", vehicle: "Hyundai i20 (Blue)" },
];

const DEMO_ROUTES = [
  { fromName: "Kondapur",   toName: "HITEC City",    distanceKm: 6  },
  { fromName: "Madhapur",   toName: "Gachibowli",    distanceKm: 8  },
  { fromName: "Kompally",   toName: "Secunderabad",  distanceKm: 22 },
];

// Morning slots for going to work
const SLOTS = ["07:30 AM", "08:00 AM", "08:30 AM", "09:00 AM", "09:30 AM"];

function nextDays(n) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.\n");

  const createdHostIds   = [];
  const createdRouteIds  = [];
  const createdTripIds   = [];

  // ── Hosts ────────────────────────────────────────────────────────────────
  console.log("Seeding demo hosts...");
  for (const h of DEMO_HOSTS) {
    const existing = await client.query(`SELECT id FROM "Host" WHERE phone = $1`, [h.phone]);
    if (existing.rows.length) {
      console.log(`  SKIP host ${h.name} (already exists)`);
      createdHostIds.push(existing.rows[0].id);
      continue;
    }
    const res = await client.query(
      `INSERT INTO "Host" (id, name, phone, vehicle, active, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW())
       RETURNING id`,
      [h.name, h.phone, h.vehicle]
    );
    createdHostIds.push(res.rows[0].id);
    console.log(`  Created host: ${h.name}`);
  }

  // ── Routes ───────────────────────────────────────────────────────────────
  console.log("\nSeeding demo routes...");
  for (const r of DEMO_ROUTES) {
    const existing = await client.query(
      `SELECT id FROM "Route" WHERE "fromName" = $1 AND "toName" = $2`,
      [r.fromName, r.toName]
    );
    if (existing.rows.length) {
      console.log(`  SKIP route ${r.fromName} → ${r.toName} (already exists)`);
      createdRouteIds.push(existing.rows[0].id);
      continue;
    }
    const res = await client.query(
      `INSERT INTO "Route" (id, "fromName", "toName", "distanceKm", active)
       VALUES (gen_random_uuid()::text, $1, $2, $3, true)
       RETURNING id`,
      [r.fromName, r.toName, r.distanceKm]
    );
    createdRouteIds.push(res.rows[0].id);
    console.log(`  Created route: ${r.fromName} → ${r.toName}`);
  }

  // ── Trips (5 days × 3 routes × 2 hosts, varied) ──────────────────────────
  console.log("\nSeeding demo trips...");
  const days = nextDays(5);

  const tripPlan = [
    // [routeIdx, hostIdx, slotIdx, seats, price, rideMode]
    [0, 0, 1, 3, 149, "WOMEN_ONLY"],
    [0, 1, 2, 4, 149, "MIXED"],
    [1, 1, 1, 3, 129, "MIXED"],
    [1, 2, 3, 4, 129, "MIXED"],
    [2, 2, 0, 3, 199, "MIXED"],
    [2, 0, 2, 3, 199, "WOMEN_ONLY"],
  ];

  for (const day of days) {
    for (const [ri, hi, si, seats, price, mode] of tripPlan) {
      const routeId = createdRouteIds[ri];
      const hostId  = createdHostIds[hi];
      const slot    = SLOTS[si];

      const existing = await client.query(
        `SELECT id FROM "Trip" WHERE "routeId" = $1 AND "hostId" = $2 AND "departureTime" = $3 AND "tripDate" = $4`,
        [routeId, hostId, slot, day]
      );
      if (existing.rows.length) {
        createdTripIds.push(existing.rows[0].id);
        continue;
      }

      const res = await client.query(
        `INSERT INTO "Trip" (id, "routeId", "hostId", "departureTime", "tripDate", "totalSeats", "seatsLeft", "priceInr", status, "rideMode", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $5, $6, 'OPEN', $7, NOW())
         RETURNING id`,
        [routeId, hostId, slot, day, seats, price, mode]
      );
      createdTripIds.push(res.rows[0].id);
    }
  }
  console.log(`  Created ${createdTripIds.length} trips across 5 days`);

  // ── Save IDs for cleanup ─────────────────────────────────────────────────
  const fs = require("fs"), path = require("path");
  const manifest = { hosts: createdHostIds, routes: createdRouteIds, trips: createdTripIds };
  const outPath = path.join(__dirname, "demo_manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log("\n✅ Demo data seeded.");
  console.log(`   Hosts:  ${createdHostIds.length}`);
  console.log(`   Routes: ${createdRouteIds.length}`);
  console.log(`   Trips:  ${createdTripIds.length}`);
  console.log(`\n   Manifest saved to scripts/demo_manifest.json`);
  console.log("   Run cleanup_demo.js when you want to remove all demo data.\n");

  await client.end();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
