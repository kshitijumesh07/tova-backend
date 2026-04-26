const express = require("express");
const prisma   = require("../services/db");
const { getPickupZones, getDestinationsFor, findTripsForRoute } = require("../services/matching");
const { notifyUser }                                            = require("../services/notify");
const { getSession, setSession, clearSession }                  = require("../services/session");

const router = express.Router();

// ── Meta webhook verification ────────────────────────────────────────────────

router.get("/incoming", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function numberedList(items) {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

function rideLabel(r) {
  const mode = r.rideMode === "WOMEN_ONLY" ? " | 👩 Women only" : "";
  return `${r.time} | ₹${r.price} | ${r.seats} seat(s)${mode}`;
}

async function getUserGender(phone) {
  const user = await prisma.user.findUnique({ where: { phone }, select: { gender: true } });
  return user?.gender || null;
}

async function saveUserGender(phone, gender) {
  await prisma.user.upsert({
    where:  { phone },
    update: { gender },
    create: { phone, gender },
  });
}

// ── Incoming messages ────────────────────────────────────────────────────────

router.post("/incoming", async (req, res) => {
  res.status(200).send("OK");

  const entry  = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg    = change?.messages?.[0];

  if (!msg || msg.type !== "text") return;

  const phone = msg.from;
  const text  = (msg.text?.body || "").trim();
  const lower = text.toLowerCase();

  console.log("WA INCOMING:", phone, "|", text);

  const session = await getSession(phone);

  let reply;

  // ── Start / reset ────────────────────────────────────────────────────────

  if (lower === "hi" || lower === "hello" || lower === "start" || lower === "menu") {
    const gender = await getUserGender(phone);

    if (!gender) {
      // First-time user — ask gender once
      await setSession(phone, { step: "GENDER" });
      reply = "Welcome to TOVA!\n\nBefore we start, are you:\n1. Female\n2. Male\n3. Prefer not to say";
    } else {
      await setSession(phone, { step: "DIRECTION", gender });
      reply = "Welcome back to TOVA!\n\n1. Going to Work\n2. Returning Home";
    }

  // ── Gender (first time only) ──────────────────────────────────────────────

  } else if (session.step === "GENDER") {
    const map = { "1": "FEMALE", "2": "MALE", "3": "OTHER" };
    if (!map[text]) {
      reply = "Please reply 1, 2, or 3.\n\n1. Female\n2. Male\n3. Prefer not to say";
    } else {
      const gender = map[text];
      await saveUserGender(phone, gender);
      await setSession(phone, { step: "DIRECTION", gender });
      reply = "Got it!\n\n1. Going to Work\n2. Returning Home";
    }

  // ── Step 1: direction ────────────────────────────────────────────────────

  } else if (session.step === "DIRECTION") {
    if (text !== "1" && text !== "2") {
      reply = "Please reply 1 or 2.\n\n1. Going to Work\n2. Returning Home";
    } else {
      session.direction = text === "1" ? "work" : "return";

      const zones = await getPickupZones();
      if (zones.length === 0) {
        await clearSession(phone);
        reply = "No active routes today. Type 'hi' to try again later.";
      } else {
        session.zones = zones;
        session.step  = "PICKUP_ZONE";
        await setSession(phone, session);
        reply = `Choose your pickup zone:\n${numberedList(zones)}`;
      }
    }

  // ── Step 2: pickup zone ──────────────────────────────────────────────────

  } else if (session.step === "PICKUP_ZONE") {
    const idx   = parseInt(text, 10) - 1;
    const zones = session.zones || [];

    if (isNaN(idx) || idx < 0 || idx >= zones.length) {
      reply = `Please reply with a number 1–${zones.length}.\n${numberedList(zones)}`;
    } else {
      session.pickupZone = zones[idx];

      const dests = await getDestinationsFor(session.pickupZone);
      if (dests.length === 0) {
        await clearSession(phone);
        reply = "No destinations available from that zone. Type 'hi' to try again.";
      } else {
        session.dests = dests;
        session.step  = "DESTINATION";
        await setSession(phone, session);
        reply = `Pickup: ${session.pickupZone}\n\nChoose your destination:\n${numberedList(dests)}`;
      }
    }

  // ── Step 3: destination ──────────────────────────────────────────────────

  } else if (session.step === "DESTINATION") {
    const idx   = parseInt(text, 10) - 1;
    const dests = session.dests || [];

    if (isNaN(idx) || idx < 0 || idx >= dests.length) {
      reply = `Please reply with a number 1–${dests.length}.\n${numberedList(dests)}`;
    } else {
      session.destination = dests[idx];

      const gender   = session.gender || (await getUserGender(phone));
      const allRides = await findTripsForRoute(session.pickupZone, session.destination);

      // Filter: male users cannot see women-only rides
      const rides = allRides.filter(
        (r) => r.rideMode !== "WOMEN_ONLY" || gender === "FEMALE"
      );

      if (rides.length === 0) {
        await clearSession(phone);
        reply = "No rides available on this route today. Type 'hi' to start over.";
      } else {
        session.foundRides = rides;
        session.step       = "SELECTING_RIDE";
        await setSession(phone, session);
        const list = rides.map((r, i) => `${i + 1}. ${rideLabel(r)}`).join("\n");
        reply = `${session.pickupZone} → ${session.destination}\n\nAvailable rides:\n${list}\n\nReply with a number to book:`;
      }
    }

  // ── Step 4: select ride ──────────────────────────────────────────────────

  } else if (session.step === "SELECTING_RIDE") {
    const idx   = parseInt(text, 10) - 1;
    const rides = session.foundRides || [];

    if (isNaN(idx) || idx < 0 || idx >= rides.length) {
      reply = `Please reply with a number 1–${rides.length}.`;
    } else {
      const ride = rides[idx];
      await clearSession(phone);
      const link = `https://tova-web.vercel.app/checkout?ride=${ride.id}&user=${encodeURIComponent("+" + phone)}`;
      reply = `Ride selected!\n${ride.time} | ₹${ride.price} | ${ride.seats} seat(s)\n\nTap to pay:\n${link}`;
    }

  // ── Fallback ─────────────────────────────────────────────────────────────

  } else {
    reply = "Type 'hi' to start a new booking.";
  }

  if (reply) notifyUser(phone, reply);
});

module.exports = router;
