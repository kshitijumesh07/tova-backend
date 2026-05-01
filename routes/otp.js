const express    = require("express");
const prisma     = require("../services/db");
const { notifyUser }               = require("../services/notify");
const { setOtp, getOtp, clearOtp } = require("../services/session");

const router = express.Router();
const KEY    = (tripId) => `ride:${tripId}`;
const TTL    = 7200; // 2 hours — survives until well after departure

// POST /otp/generate — rider initiates ride-start OTP
// Body: { tripId, phone }
// Returns: { otp } so rider can display it on screen (Rapido style)
router.post("/generate", async (req, res) => {
  const { tripId } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!tripId || !phone) return res.status(400).json({ error: "tripId and phone required" });

  const flag = await prisma.featureFlag.findUnique({ where: { key: "otp_ride_start" } }).catch(() => null);
  if (!flag?.enabled) return res.status(403).json({ error: "OTP ride start is not enabled." });

  const booking = await prisma.booking.findFirst({ where: { phone, tripId, status: "CONFIRMED" } });
  if (!booking) return res.status(403).json({ error: "No confirmed booking for this trip." });

  const trip = await prisma.trip.findUnique({
    where:   { id: tripId },
    include: { route: { select: { fromName: true, toName: true } }, host: { select: { phone: true } } },
  });
  if (!trip)                       return res.status(404).json({ error: "Trip not found." });
  if (trip.status === "CANCELLED") return res.status(409).json({ error: "Trip is cancelled." });

  // Reuse existing OTP — never regenerate for the same trip
  const existing = await getOtp(KEY(tripId));
  let state;
  if (existing) {
    try { state = JSON.parse(existing); } catch { state = null; }
  }
  if (!state) {
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    state = { otp, riderPhone: phone, hostPhone: trip.host.phone };
    await setOtp(KEY(tripId), JSON.stringify(state), TTL);
    console.log("[otp] generated for trip:", tripId, "otp:", otp);
  } else {
    console.log("[otp] resent for trip:", tripId);
  }

  const routeLabel = trip.route ? `${trip.route.fromName} → ${trip.route.toName}` : trip.departureTime;
  await notifyUser(phone,           `🔢 *Your TOVA ride OTP: ${state.otp}*\n\nShow this to your host.\n${routeLabel} · ${trip.departureTime}`).catch(() => {});
  await notifyUser(trip.host.phone, `🔢 *TOVA Ride OTP: ${state.otp}*\n\nAsk your rider for this code and enter it to start the ride.\n${routeLabel} · ${trip.departureTime}`).catch(() => {});

  res.json({ sent: true, otp: state.otp });
});

// POST /otp/confirm — host enters OTP → ride starts immediately
// Body: { tripId, phone (host phone), otp }
router.post("/confirm", async (req, res) => {
  const { tripId, otp } = req.body;
  const phone = (req.body.phone || "").replace(/^\+/, "");
  if (!tripId || !phone || !otp) return res.status(400).json({ error: "tripId, phone, and otp required" });

  const raw = await getOtp(KEY(tripId));
  if (!raw) return res.status(401).json({ error: "OTP not found. Ask your rider to generate one." });

  let state;
  try { state = JSON.parse(raw); } catch { return res.status(500).json({ error: "Invalid OTP state." }); }

  if (state.otp !== String(otp)) return res.status(401).json({ error: "Wrong OTP. Ask your rider to confirm the code." });
  if (phone !== state.hostPhone)  return res.status(403).json({ error: "Only the host can confirm the ride start." });

  await clearOtp(KEY(tripId));
  await prisma.trip.update({ where: { id: tripId }, data: { status: "IN_PROGRESS" } });
  await notifyUser(state.riderPhone, `✅ Ride started! Have a safe journey. 🚗`).catch(() => {});
  await notifyUser(state.hostPhone,  `✅ Ride started! Drive safe. 🚗`).catch(() => {});

  console.log("[otp] ride started:", tripId);
  res.json({ started: true });
});

module.exports = router;
