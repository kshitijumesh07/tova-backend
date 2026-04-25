# TOVA Deployment Guide

## Backend — Railway

**Live URL:** https://tova-backend-production.up.railway.app

**Deploy process:**
```bash
git add .
git commit -m "your message"
git push
# Railway auto-redeploys on push to main
```

**Verify deploy succeeded:**
- Railway dashboard → Deploy Logs → must show `RUNNING <PORT>` and `ENV KEY: loaded`
- HTTP Logs → test endpoints return 200

**Required Railway Variables:**
```
RAZORPAY_KEY
RAZORPAY_SECRET
RAZORPAY_WEBHOOK_SECRET
WHATSAPP_TOKEN
WHATSAPP_PHONE_ID
WHATSAPP_MODE          # sandbox | production
PORT                   # set automatically by Railway
```

**Razorpay Webhook:**
- URL: https://tova-backend-production.up.railway.app/webhook/razorpay
- Events: payment.captured, payment.failed

## Frontend — Vercel

**Deploy process:**
```bash
cd tova-web
npx vercel --prod
```

**Required Vercel Variables:**
```
NEXT_PUBLIC_API_URL=https://tova-backend-production.up.railway.app
```

## When To Migrate Away

Only if:
- Enterprise compliance requires self-hosting
- Costs become inefficient at scale
- Custom networking / infra required
- Security team requires dedicated cloud stack

Do not migrate for preference or habit.
