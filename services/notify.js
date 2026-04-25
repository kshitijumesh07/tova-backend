const https = require("https");

function notifyUser(phone, message) {
  const TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  if (!TOKEN || !PHONE_ID) {
    console.error("META WHATSAPP ERROR: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set in environment");
    return;
  }

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
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Length": Buffer.byteLength(body),
    },
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log("META WHATSAPP SENT:", phone, "|", data);
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
