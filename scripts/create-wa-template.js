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
      name:      "tova_otp_code",
      language:  "en",
      category:  "AUTHENTICATION",
      components: [
        {
          type:                        "BODY",
          add_security_recommendation: true,
        },
        {
          type:                   "FOOTER",
          code_expiration_minutes: 5,
        },
        {
          type:    "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
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
