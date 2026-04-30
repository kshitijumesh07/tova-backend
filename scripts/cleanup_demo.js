const { Client } = require("pg");
const fs = require("fs"), path = require("path");

const DB_URL = process.argv[2];
if (!DB_URL) { console.error("Usage: node scripts/cleanup_demo.js <DATABASE_URL>"); process.exit(1); }

async function main() {
  const manifestPath = path.join(__dirname, "demo_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("demo_manifest.json not found. Run seed_demo.js first.");
    process.exit(1);
  }
  const { hosts, routes, trips } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected. Removing demo data...\n");

  // Must delete in order: bookings that reference trips, then trips, routes, hosts
  if (trips.length) {
    await client.query(`DELETE FROM "Booking" WHERE "tripId" = ANY($1::text[])`, [trips]);
    const t = await client.query(`DELETE FROM "Trip"    WHERE id = ANY($1::text[])`, [trips]);
    console.log(`  Deleted ${t.rowCount} trips`);
  }
  if (routes.length) {
    const r = await client.query(`DELETE FROM "Route" WHERE id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM "Trip" WHERE "routeId" = "Route".id)`, [routes]);
    console.log(`  Deleted ${r.rowCount} routes (skipped any with real trips)`);
  }
  if (hosts.length) {
    const h = await client.query(`DELETE FROM "Host" WHERE id = ANY($1::text[]) AND phone LIKE '91000000000%'`, [hosts]);
    console.log(`  Deleted ${h.rowCount} demo hosts`);
  }

  fs.unlinkSync(manifestPath);
  console.log("\n✅ Demo data cleaned up. Manifest deleted.");
  await client.end();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
