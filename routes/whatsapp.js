const express = require("express");
const { matchRides } = require("../services/matching");
const { notifyUser } = require("../services/notify");

const router = express.Router();

const sessions = {};

function formatRides(rides) {
  return rides
    .map((r, i) => `${i + 1}. ${r.time} | ₹${r.price} | ${r.seats} seats`)
    .join("\n");
}

// Meta webhook verification
router.get("/incoming", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

// Meta webhook incoming messages
router.post("/incoming", (req, res) => {
  // Acknowledge immediately so Meta doesn't retry
  res.status(200).send("OK");

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];

  if (!msg || (msg.type !== "text" && msg.type !== "location")) return;

  const phone = msg.from; // e.g. "919390537737"

  let text = "";
  let locationMeta = null;

  if (msg.type === "location") {
    const loc = msg.location || {};
    locationMeta = {
      latitude:  loc.latitude,
      longitude: loc.longitude,
      name:      loc.name    || null,
      address:   loc.address || null,
    };
    // Build a human-readable label for the session
    text = loc.name || loc.address || `${loc.latitude},${loc.longitude}`;
  } else {
    text = (msg.text?.body || "").trim();
  }

  const lower = text.toLowerCase();

  console.log("WA INCOMING:", phone, "|", text);

  if (!sessions[phone]) sessions[phone] = { step: "START" };
  const session = sessions[phone];

  let reply;

  if (lower === "hi" || lower === "hello") {
    sessions[phone] = { step: "AWAITING_PICKUP" };
    reply = "Welcome to TOVA!\nEnter your pickup location:";

  } else if (session.step === "AWAITING_PICKUP") {
    if (!text) {
      reply = "Please enter a valid pickup location.";
    } else {
      session.pickup = text;
      if (locationMeta) session.pickupCoords = locationMeta;
      session.step = "AWAITING_DESTINATION";
      reply = "Enter your destination:";
    }

  } else if (session.step === "AWAITING_DESTINATION") {
    if (!text) {
      reply = "Please enter a valid destination.";
    } else {
      session.destination = text;
      if (locationMeta) session.destinationCoords = locationMeta;
      session.step = "AWAITING_TIME";
      reply = "Enter preferred time (e.g. 8:00 AM or 6:00 PM):";
    }

  } else if (session.step === "AWAITING_TIME") {
    if (!text) {
      reply = "Please enter a valid time.";
    } else {
      session.time = text;
      const result = matchRides(session.pickup, session.destination, session.time);

      if (result.error) {
        sessions[phone] = { step: "START" };
        reply = `${result.error}. Type 'hi' to start over.`;
      } else if (result.length === 0) {
        sessions[phone] = { step: "START" };
        reply = "No rides found for that time. Type 'hi' to start over.";
      } else {
        session.foundRides = result;
        session.step = "SELECTING_RIDE";
        reply = `Available rides:\n${formatRides(result)}\nReply with number to select:`;
      }
    }

  } else if (session.step === "SELECTING_RIDE") {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || !session.foundRides || idx >= session.foundRides.length) {
      reply = `Invalid choice. Reply with a number between 1 and ${session.foundRides?.length ?? 1}.`;
    } else {
      const ride = session.foundRides[idx];
      session.step = "START";
      const link = `https://tova-web.vercel.app/checkout?ride=${ride.id}&user=${encodeURIComponent("+" + phone)}`;
      reply = `Ride confirmed: ${ride.time} | ₹${ride.price}\nClick to pay:\n${link}`;
    }

  } else {
    reply = "Please follow the steps. Type 'hi' to start.";
  }

  notifyUser(phone, reply);
});

module.exports = router;
