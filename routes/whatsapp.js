const express = require("express");
const { matchRides } = require("../services/matching");

const router = express.Router();

const sessions = {};

function formatRides(rides) {
  return rides
    .map((r, i) => `${i + 1}. ${r.time} | ₹${r.price} | ${r.seats} seats`)
    .join("\n");
}

router.post("/incoming", (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));

  // Step 2: phone number IS the user identity
  const phone = req.body.phone;
  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  const text = (req.body.message?.text || "").trim();
  const lower = text.toLowerCase();

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
      session.step = "AWAITING_DESTINATION";
      reply = "Enter your destination:";
    }

  } else if (session.step === "AWAITING_DESTINATION") {
    if (!text) {
      reply = "Please enter a valid destination.";
    } else {
      session.destination = text;
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
      session.selectedRide = ride;
      session.step = "START";
      // Step 1+2: checkout link carries both ride_id and user_id (phone)
      const link = `http://localhost:3001/checkout?ride_id=${ride.id}&user_id=${encodeURIComponent(phone)}`;
      reply = `Ride confirmed: ${ride.time} | ₹${ride.price}\nClick to pay:\n${link}`;
    }

  } else {
    reply = "Please follow the steps. Type 'hi' to start.";
  }

  res.json({ message: reply });
});

module.exports = router;
