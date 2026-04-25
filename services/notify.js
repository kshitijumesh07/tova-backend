async function notifyUser(phone, message) {
  const TOKEN    = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  if (!TOKEN || !PHONE_ID) {
    console.error("[notify] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set");
    return;
  }

  // Meta API expects phone without leading +
  const to = phone.replace(/^\+/, "");

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${TOKEN}`,
      },
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

module.exports = { notifyUser };
