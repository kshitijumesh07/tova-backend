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
app.use("/api",     require("./routes/api"));

app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING", PORT);
  console.log("ENV KEY:", process.env.RAZORPAY_KEY ? "loaded" : "missing");
});
