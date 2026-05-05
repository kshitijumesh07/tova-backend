// Run once to register the OTP template with Meta.
// Usage: WHATSAPP_TOKEN=xxx WHATSAPP_WABA_ID=943704188287137 node scripts/create-wa-template.js

const TOKEN   = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WHATSAPP_WABA_ID || "943704188287137";

if (!TOKEN) {
  console.error("Set WHATSAPP_TOKEN env var before running.");
  process.exit(1);
}

async function createTemplate() {
  const res = await fetch(`https://graph.facebook.com/v25.0/${WABA_ID}/message_templates`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      name:      "tova_otp",
      language:  "en",
      category:  "AUTHENTICATION",
      components: [
        {
          type: "BODY",
          text: "{{1}} is your TOVA verification code. Valid for 5 minutes. Do not share this with anyone.",
          example: { body_text: [["123456"]] },
        },
        {
          type:    "FOOTER",
          text:    "This code expires in 5 minutes.",
        },
      ],
    }),
  });

  const data = await res.json();
  if (res.ok) {
    console.log("Template created! ID:", data.id, "| Status:", data.status);
    console.log("Authentication templates are usually approved in a few minutes.");
  } else {
    console.error("Error:", JSON.stringify(data, null, 2));
  }
}

createTemplate().catch(console.error);
