# TOVA Security Policy

## Secret Management

| Secret | Where it lives | Never do this |
|--------|---------------|---------------|
| RAZORPAY_KEY | Railway Variables | Commit to git |
| RAZORPAY_SECRET | Railway Variables | Log the value |
| RAZORPAY_WEBHOOK_SECRET | Railway Variables | Hardcode in code |
| WHATSAPP_TOKEN | Railway Variables | Expose client-side |
| WHATSAPP_PHONE_ID | Railway Variables | Put in .env committed |

## Rotation Schedule

- Razorpay keys: rotate if any team member leaves
- WhatsApp token: rotate every 90 days or on suspected leak
- Webhook secret: rotate if webhook URL is ever changed

## Access Controls

- GitHub repo: owner + named collaborators only
- Railway: owner only during pre-traction phase
- Meta Developer app: owner only
- Razorpay dashboard: owner only

## What To Do If A Secret Leaks

1. Immediately rotate the leaked secret in its dashboard
2. Update Railway Variables with new value
3. Verify Railway redeploys and `ENV KEY: loaded` appears in logs
4. Audit recent API calls in Razorpay / Meta dashboards for anomalies

## MFA Required On

- GitHub
- Railway
- Vercel
- Meta Developer Platform
- Razorpay
