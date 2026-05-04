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
app.use("/host",    require("./routes/host"));
app.use("/rider",   require("./routes/rider"));
app.use("/ride",    require("./routes/ride"));
app.use("/debug",   require("./routes/debug"));
app.use("/admin",   require("./routes/admin"));
app.use("/otp",     require("./routes/otp"));
app.use("/auth",    require("./routes/auth"));
app.use("/api",     require("./routes/api"));

app.get("/", (req, res) => res.send("OK"));

// Seed feature flags on startup — creates rows with safe defaults if missing
async function seedFlags() {
  const prisma = require("./services/db");
  const defaults = [
    { key: "invite_only",          enabled: false, label: "Invite Only Mode" },
    { key: "manual_verification",  enabled: false, label: "Manual Verification" },
    { key: "otp_ride_start",       enabled: true,  label: "OTP Ride Start" },
    { key: "live_tracking",        enabled: false, label: "Live Tracking" },
    { key: "emergency_trigger",    enabled: true,  label: "Emergency Trigger" },
    { key: "repeat_pairing_bias",  enabled: true,  label: "Repeat Pairing Bias" },
    { key: "host_open",            enabled: true,  label: "Host Registration Open" },
    { key: "ride_requests",        enabled: true,  label: "Demand Waitlist (Ride Requests)" },
  ];
  try {
    for (const flag of defaults) {
      await prisma.featureFlag.upsert({
        where:  { key: flag.key },
        update: {},
        create: flag,
      });
    }
    console.log("[flags] seeded", defaults.length, "feature flags");
  } catch (err) {
    console.error("[flags] seed failed:", err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("RUNNING", PORT);
  console.log("ENV KEY:", process.env.RAZORPAY_KEY ? "loaded" : "missing");
  console.log("WA TOKEN:", process.env.WHATSAPP_TOKEN ? "loaded" : "MISSING");
  console.log("WA PHONE ID:", process.env.WHATSAPP_PHONE_ID ? "loaded" : "MISSING");
  await seedFlags();
});
