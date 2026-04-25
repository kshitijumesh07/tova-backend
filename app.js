const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());

// webhook MUST be before express.json() to receive raw body for HMAC verification
app.use("/webhook", require("./routes/webhook"));

app.use(express.json());

app.use("/whatsapp", require("./routes/whatsapp"));
app.use("/trip",    require("./routes/trip"));
app.use("/payment", require("./routes/payment"));
app.use("/payment", require("./routes/verify"));
app.use("/booking", require("./routes/booking"));
app.use("/debug",   require("./routes/debug"));

// TEMP: resend confirmation for latest booking — remove after test
app.get("/resend-test", async (req, res) => {
  const prisma = require("./services/db");
  const { notifyUser } = require("./services/notify");
  const booking = await prisma.booking.findFirst({
    orderBy: { createdAt: "desc" },
    where:   { status: "CONFIRMED" },
    include: { trip: { include: { route: true } } },
  });
  if (!booking) return res.json({ error: "no confirmed booking" });
  const route = booking.trip?.route;
  const line  = route ? `${route.fromName} → ${route.toName} | ${booking.trip.departureTime}` : booking.orderId;
  await notifyUser(booking.phone, `Booking confirmed!\n${line}\n\nSee you at the pickup stop.`);
  res.json({ sent: true, to: booking.phone, line });
});

app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING", PORT);
  console.log("ENV KEY:", process.env.RAZORPAY_KEY ? "loaded" : "missing");
});
