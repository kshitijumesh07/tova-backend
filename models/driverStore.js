const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(__dirname, "../data/drivers.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { drivers: [] };
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getAvailableDrivers(route, time) {
  const { drivers } = load();
  return drivers.filter((d) => d.route === route && d.time === time && d.seats > 0 && d.active);
}

function reduceDriverSeat(driverId) {
  const db = load();
  const driver = db.drivers.find((d) => d.id === driverId);
  if (driver && driver.seats > 0) {
    driver.seats -= 1;
    save(db);
  }
}

// Used to manually onboard a real driver
function addDriver({ id, name, phone, vehicle, route, time, seats }) {
  const db = load();
  const exists = db.drivers.find((d) => d.id === id);
  if (exists) return { error: "Driver already exists" };
  db.drivers.push({ id, name, phone, vehicle, route, time, seats, active: true, onboarded_at: new Date().toISOString() });
  save(db);
  console.log("DRIVER ONBOARDED:", name, phone, route, time);
  return { success: true };
}

function getDrivers() {
  return load().drivers;
}

module.exports = { getAvailableDrivers, reduceDriverSeat, addDriver, getDrivers };
