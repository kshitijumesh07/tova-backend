const express    = require("express");
const prisma     = require("../services/db");
const { notifyUser }                        = require("../services/notify");
const { setOtp, getOtp, clearOtp }          = require("../services/session");

const router = express.Router();

const KEY = (tripId) => `ride:${tripId}`;

// POST /otp/generate — rider requests ride-start OTP
// Body: { tripId, phone }
router.post("/generate", async (req, res) => {
  const { tripId } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!tripId || !phone) return res.status(400).json({ error: "tripId and phone required" });

  const flag = await prisma.featureFlag.findUnique({ where: { key: "otp_ride_start" } }).catch(() => null);
  if (!flag?.enabled) return res.status(403).json({ error: "OTP ride start is not enabled." });

  const booking = await prisma.booking.findFirst({ where: { phone, tripId, status: "CONFIRMED" } });
  if (!booking) return res.status(403).json({ error: "No confirmed booking for this trip." });

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { route: { select: { fromName: true, toName: true } }, host: { select: { phone: true } } },
  });
  if (!trip)                       return res.status(404).json({ error: "Trip not found." });
  if (trip.status === "CANCELLED") return res.status(409).json({ error: "Trip is cancelled." });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const state = { otp, riderPhone: phone, hostPhone: trip.host.phone, riderConfirmed: false, hostConfirmed: false };
  await setOtp(KEY(tripId), JSON.stringify(state));

  const routeLabel = trip.route ? `${trip.route.fromName} → ${trip.route.toName}` : trip.departureTime;
  await notifyUser(phone,           `🔢 *TOVA Ride OTP: ${otp}*\n\nShare with your host to start the ride.\n${routeLabel} at ${trip.departureTime}`).catch(() => {});
  await notifyUser(trip.host.phone, `🔢 *TOVA Ride OTP: ${otp}*\n\nConfirm this code with your rider before departure.\n${routeLabel} at ${trip.departureTime}`).catch(() => {});

  console.log("[otp] generated for trip:", tripId);
  res.json({ sent: true });
});

// POST /otp/confirm — rider or host confirms with OTP
// Body: { tripId, phone, otp }
router.post("/confirm", async (req, res) => {
  const { tripId, otp } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!tripId || !phone || !otp) return res.status(400).json({ error: "tripId, phone, and otp required" });

  const raw = await getOtp(KEY(tripId));
  if (!raw) return res.status(401).json({ error: "OTP expired or not generated. Request a new one." });

  let state;
  try { state = JSON.parse(raw); } catch { return res.status(500).json({ error: "Invalid OTP state." }); }

  if (state.otp !== otp) return res.status(401).json({ error: "Wrong OTP." });

  if      (phone === state.riderPhone) state.riderConfirmed = true;
  else if (phone === state.hostPhone)  state.hostConfirmed  = true;
  else return res.status(403).json({ error: "Phone not part of this ride." });

  if (state.riderConfirmed && state.hostConfirmed) {
    await clearOtp(KEY(tripId));
    await prisma.trip.update({ where: { id: tripId }, data: { status: "IN_PROGRESS" } });
    await notifyUser(state.riderPhone, `✅ Ride started! Have a safe journey. 🚗`).catch(() => {});
    await notifyUser(state.hostPhone,  `✅ Ride started! Drive safe. 🚗`).catch(() => {});
    return res.json({ confirmed: true, started: true });
  }

  await setOtp(KEY(tripId), JSON.stringify(state));
  const waiting = state.riderConfirmed ? "Waiting for host to confirm." : "Waiting for rider to confirm.";
  res.json({ confirmed: true, started: false, waiting });
});

module.exports = router;
