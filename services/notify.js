const https = require("https");

// WHATSAPP_MODE=sandbox  → sends hello_world template (Meta test numbers)
// WHATSAPP_MODE=production → sends custom text (requires Meta business verification)
// WHATSAPP_TEMPLATE_NAME  → override template name (default: hello_world)
const MODE = process.env.WHATSAPP_MODE || "sandbox";
const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || "hello_world";

function notifyUser(phone, message) {
  const TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  if (!TOKEN || !PHONE_ID) {
    console.error("META WHATSAPP ERROR: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set");
    return;
  }

  // Meta API expects phone without leading +
  const to = phone.replace(/^\+/, "");

  // Text replies work within 24h of user-initiated conversation (sandbox included)
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message },
  });

  const req = https.request({
    hostname: "graph.facebook.com",
    path: `/v25.0/${PHONE_ID}/messages`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Length": Buffer.byteLength(body),
    },
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log("META TEMPLATE SENT:", phone, "|", data);
      } else {
        console.error("META WHATSAPP ERROR:", res.statusCode, data);
      }
    });
  });

  req.on("error", (e) => console.error("META WHATSAPP ERROR:", e.message));
  req.write(body);
  req.end();
}

module.exports = { notifyUser };
