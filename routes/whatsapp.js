const express = require("express");
const prisma   = require("../services/db");
const { getPickupZones, getDestinationsFor, findTripsForRoute } = require("../services/matching");
const { notifyUser }                                            = require("../services/notify");
const { getSession, setSession, clearSession }                  = require("../services/session");
const { getLatestConfirmedBooking }                             = require("../models/bookingStore");
const { processRefund }                                         = require("../services/refund");

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
      reply = "👋 Hello! Welcome to TOVA — Hyderabad's verified daily commute service.\n\nTo match you with the right rides, could you tell us a little about yourself?\n\nAre you:\n1. A woman\n2. A man\n3. Prefer not to say\n\nReply with 1, 2, or 3.";
    } else {
      await setSession(phone, { step: "DIRECTION", gender });
      reply = "👋 Welcome back to TOVA! Great to see you again.\n\nAre you commuting today?\n1. Going to Work\n2. Returning Home\n\nReply with 1 or 2.";
    }

  // ── Gender (first time only) ──────────────────────────────────────────────

  } else if (session.step === "GENDER") {
    const map = { "1": "FEMALE", "2": "MALE", "3": "OTHER" };
    if (!map[text]) {
      reply = "Just reply with 1, 2, or 3 — we'll take it from there! 😊\n\n1. A woman\n2. A man\n3. Prefer not to say";
    } else {
      const gender = map[text];
      await saveUserGender(phone, gender);
      await setSession(phone, { step: "DIRECTION", gender });
      reply = "Perfect, thank you! 🙏\n\nNow, are you commuting today?\n1. Going to Work\n2. Returning Home\n\nReply with 1 or 2.";
    }

  // ── Step 1: direction ────────────────────────────────────────────────────

  } else if (session.step === "DIRECTION") {
    if (text !== "1" && text !== "2") {
      reply = "Please reply with 1 or 2:\n\n1. Going to Work\n2. Returning Home";
    } else {
      session.direction = text === "1" ? "work" : "return";

      const zones = await getPickupZones();
      if (zones.length === 0) {
        await clearSession(phone);
        reply = "Sorry, there are no active routes today. 😔\n\nPlease check back tomorrow or type *hi* to try again later.";
      } else {
        session.zones = zones;
        session.step  = "PICKUP_ZONE";
        await setSession(phone, session);
        reply = `Got it! 👍 Where will you be boarding from?\n\n${numberedList(zones)}\n\nReply with the number of your pickup area.`;
      }
    }

  // ── Step 2: pickup zone ──────────────────────────────────────────────────

  } else if (session.step === "PICKUP_ZONE") {
    const idx   = parseInt(text, 10) - 1;
    const zones = session.zones || [];

    if (isNaN(idx) || idx < 0 || idx >= zones.length) {
      reply = `Please reply with a number between 1 and ${zones.length}:\n\n${numberedList(zones)}`;
    } else {
      session.pickupZone = zones[idx];

      const dests = await getDestinationsFor(session.pickupZone);
      if (dests.length === 0) {
        await clearSession(phone);
        reply = "Sorry, we don't have any destinations available from that area right now. 😔\n\nType *hi* to start over and pick a different zone.";
      } else {
        session.dests = dests;
        session.step  = "DESTINATION";
        await setSession(phone, session);
        reply = `Great! Pickup from *${session.pickupZone}* ✅\n\nWhere are you headed?\n\n${numberedList(dests)}\n\nReply with the number of your destination.`;
      }
    }

  // ── Step 3: destination ──────────────────────────────────────────────────

  } else if (session.step === "DESTINATION") {
    const idx   = parseInt(text, 10) - 1;
    const dests = session.dests || [];

    if (isNaN(idx) || idx < 0 || idx >= dests.length) {
      reply = `Please reply with a number between 1 and ${dests.length}:\n\n${numberedList(dests)}`;
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
        reply = "Sorry, there are no rides available on this route today. 😔\n\nType *hi* to start over and try a different route.";
      } else {
        session.foundRides = rides;
        session.step       = "SELECTING_RIDE";
        await setSession(phone, session);
        const list = rides.map((r, i) => `${i + 1}. ${rideLabel(r)}`).join("\n");
        reply = `Here are the available rides from *${session.pickupZone}* → *${session.destination}*:\n\n${list}\n\nReply with the number of the ride you'd like to book. 🚗`;
      }
    }

  // ── Step 4: select ride ──────────────────────────────────────────────────

  } else if (session.step === "SELECTING_RIDE") {
    const idx   = parseInt(text, 10) - 1;
    const rides = session.foundRides || [];

    if (isNaN(idx) || idx < 0 || idx >= rides.length) {
      reply = `Please reply with a number between 1 and ${rides.length} to select your ride.`;
    } else {
      const ride = rides[idx];
      await clearSession(phone);
      const link = `https://www.gotova.in/checkout?ride=${ride.id}&user=${encodeURIComponent("+" + phone)}`;
      reply = `Almost there! 🎉\n\nYou've selected:\n🕐 ${ride.time} | ₹${ride.price} | ${ride.seats} seat(s)\n\nTap the link below to confirm and pay securely:\n${link}\n\nSee you on the road! 🚗`;
    }

  // ── Cancel ───────────────────────────────────────────────────────────────

  } else if (lower === "cancel") {
    const booking = await getLatestConfirmedBooking(phone);
    if (!booking) {
      reply = "You don't have any active bookings to cancel. Type *hi* to book a ride.";
    } else {
      const route = booking.trip?.route;
      const line  = route
        ? `${route.fromName} → ${route.toName} at ${booking.trip.departureTime}`
        : `Order ${booking.orderId}`;
      await setSession(phone, { step: "CANCEL_CONFIRM", orderId: booking.orderId });
      reply = `You have an upcoming booking:\n\n🚗 ${line}\n\nAre you sure you want to cancel and request a refund?\n\nType *confirm cancel* to proceed, or *hi* to go back.`;
    }

  } else if (session.step === "CANCEL_CONFIRM" && lower === "confirm cancel") {
    const orderId = session.orderId;
    await clearSession(phone);
    const result = await processRefund(orderId);
    if (result.error) {
      reply = `Sorry, we couldn't process your cancellation: ${result.error}\n\nPlease contact support: https://wa.me/919390537737`;
    } else if (result.skipped) {
      reply = `This booking has already been refunded. Contact support if you haven't received it.`;
    } else {
      reply = `✅ Cancellation confirmed!\n\nRefund of ₹${result.amountInr} will reflect in your account within 5–7 business days.\n\nType *hi* to book a new ride.`;
    }

  // ── Status ───────────────────────────────────────────────────────────────

  } else if (lower === "status" || lower === "my booking" || lower === "booking") {
    const booking = await getLatestConfirmedBooking(phone);
    if (!booking) {
      reply = "You don't have any active bookings right now.\n\nType *hi* to book a ride. 🚗";
    } else {
      const route = booking.trip?.route;
      const line  = route
        ? `${route.fromName} → ${route.toName} at ${booking.trip.departureTime}`
        : `Order ${booking.orderId}`;
      reply = `📋 *Your latest booking*\n\n🚗 ${line}\nStatus: ✅ Confirmed\nOrder: ${booking.orderId}\n\nType *cancel* to cancel and request a refund, or *hi* to book another ride.`;
    }

  // ── Help ─────────────────────────────────────────────────────────────────

  } else if (lower === "help" || lower === "commands" || lower === "?") {
    reply = `👋 *TOVA Commands*\n\n*hi* — Book a new ride\n*status* — Check your current booking\n*cancel* — Cancel and request a refund\n*help* — Show this list\n\nFor support: https://wa.me/919390537737`;

  // ── Fallback ─────────────────────────────────────────────────────────────

  } else {
    reply = "Hi there! 👋 Type *hi* to book a ride, *status* to check your booking, or *help* to see all commands.";
  }

  if (reply) notifyUser(phone, reply);
});

module.exports = router;
