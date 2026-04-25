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

// TEMP: WhatsApp diagnostic — remove after test
app.get("/wa-test", async (req, res) => {
  const TOKEN    = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  if (!TOKEN || !PHONE_ID) return res.json({ error: "WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set", TOKEN: !!TOKEN, PHONE_ID: !!PHONE_ID });
  const body = JSON.stringify({ messaging_product: "whatsapp", to: "919390537737", type: "text", text: { body: "TOVA test - if you see this, notifications are working." } });
  const r = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TOKEN}` }, body });
  const d = await r.json();
  res.json({ status: r.status, meta_response: d });
});

app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING", PORT);
  console.log("ENV KEY:", process.env.RAZORPAY_KEY ? "loaded" : "missing");
});
