const WA_API = "https://graph.facebook.com/v25.0";

function getCredentials() {
  return {
    TOKEN:    process.env.WHATSAPP_TOKEN,
    PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  };
}

// Send a WhatsApp OTP using the approved tova_otp authentication template.
async function sendOtp(phone, otp) {
  const { TOKEN, PHONE_ID } = getCredentials();
  if (!TOKEN || !PHONE_ID) {
    console.error("[notify] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set");
    return;
  }

  const to = phone.replace(/^\+/, "");

  try {
    const res = await fetch(`${WA_API}/${PHONE_ID}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name:     "tova_otp_code",
          language: { code: "en" },
          components: [
            {
              type:       "body",
              parameters: [{ type: "text", text: otp }],
            },
          ],
        },
      }),
    });

    const data = await res.json();
    if (res.ok) {
      console.log("[notify] OTP sent to", to, "| msg id:", data.messages?.[0]?.id);
    } else {
      console.error("[notify] Meta error", res.status, JSON.stringify(data));
    }
  } catch (err) {
    console.error("[notify] fetch error:", err.message);
  }
}

// Send a free-form text message (only works within 24h customer service window).
async function notifyUser(phone, message) {
  const { TOKEN, PHONE_ID } = getCredentials();
  if (!TOKEN || !PHONE_ID) {
    console.error("[notify] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set");
    return;
  }

  const to = phone.replace(/^\+/, "");

  try {
    const res = await fetch(`${WA_API}/${PHONE_ID}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });

    const data = await res.json();
    if (res.ok) {
      console.log("[notify] sent to", to, "| id:", data.messages?.[0]?.id);
    } else {
      console.error("[notify] Meta error", res.status, JSON.stringify(data));
    }
  } catch (err) {
    console.error("[notify] fetch error:", err.message);
  }
}

module.exports = { notifyUser, sendOtp };
