const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const DB_URL = process.argv[2];
if (!DB_URL) { console.error("Usage: node scripts/backup.js <DATABASE_URL>"); process.exit(1); }

const tables = ["User", "Host", "Route", "Trip", "Booking", "Payment"];

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.");

  const backup = { exportedAt: new Date().toISOString(), tables: {} };

  for (const table of tables) {
    const res = await client.query(`SELECT * FROM "${table}"`);
    backup.tables[table] = res.rows;
    console.log(`  ${table}: ${res.rows.length} rows`);
  }

  await client.end();

  const outPath = path.join(__dirname, `../../tova_backup_${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2));
  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nBackup saved: ${outPath} (${size} KB)`);
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
