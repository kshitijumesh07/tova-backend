const https = require("https");

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

function notifyUser(phone, message) {
  const payload = {
    to: phone,
    type: "text",
    message,
    timestamp: new Date().toISOString(),
  };

  if (TOKEN && PHONE_ID) {
    const body = JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    });

    const req = https.request({
      hostname: "graph.facebook.com",
      path: `/v25.0/${PHONE_ID}/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => console.log("META WHATSAPP RESPONSE:", data));
    });

    req.on("error", (e) => console.error("META WHATSAPP ERROR:", e.message));
    req.write(body);
    req.end();
  } else {
    console.log("WHATSAPP NOTIFY:", JSON.stringify(payload, null, 2));
  }

  return payload;
}

module.exports = { notifyUser };
