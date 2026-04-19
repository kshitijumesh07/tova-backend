const https = require("https");

const GUPSHUP_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC = process.env.GUPSHUP_SRC_NUMBER; // your Gupshup sender number

function notifyUser(phone, message) {
  const payload = {
    to: phone,
    type: "text",
    message,
    timestamp: new Date().toISOString(),
  };

  if (GUPSHUP_KEY && GUPSHUP_SRC) {
    // Real Gupshup send — drop in when keys are set
    const body = new URLSearchParams({
      channel: "whatsapp",
      source: GUPSHUP_SRC,
      destination: phone,
      message: JSON.stringify({ type: "text", text: message }),
      "src.name": "TOVA",
    }).toString();

    const req = https.request({
      hostname: "api.gupshup.io",
      path: "/sm/api/v1/msg",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: GUPSHUP_KEY,
      },
    }, (res) => {
      res.on("data", (d) => console.log("GUPSHUP RESPONSE:", d.toString()));
    });
    req.on("error", (e) => console.error("GUPSHUP ERROR:", e.message));
    req.write(body);
    req.end();
  } else {
    console.log("WHATSAPP NOTIFY:", JSON.stringify(payload, null, 2));
  }

  return payload;
}

module.exports = { notifyUser };
