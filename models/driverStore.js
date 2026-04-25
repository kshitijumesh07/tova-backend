const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(__dirname, "../data/drivers.json");

// Default drivers used when data/drivers.json doesn't exist (e.g. Railway cold deploy)
const DEFAULT_DRIVERS = [
  { id: "d1", name: "Driver 1", phone: "", vehicle: "", route: "Sainikpuri-Hitech City", time: "8:00 AM", seats: 3, active: true },
  { id: "d2", name: "Driver 2", phone: "", vehicle: "", route: "Sainikpuri-Hitech City", time: "8:00 AM", seats: 3, active: true },
  { id: "d3", name: "Driver 3", phone: "", vehicle: "", route: "Sainikpuri-Hitech City", time: "8:00 AM", seats: 4, active: true },
];

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.drivers || db.drivers.length === 0) return { drivers: DEFAULT_DRIVERS };
    return db;
  } catch {
    return { drivers: DEFAULT_DRIVERS };
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
