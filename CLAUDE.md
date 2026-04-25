# TOVA Backend

## Stack
- Runtime: Node.js + Express on Railway
- Payments: Razorpay (webhook = source of truth)
- WhatsApp: Meta Cloud API v25.0 via `services/notify.js`
- Storage: PostgreSQL on Railway via Prisma (models: User, Booking, Payment)

## Security Non-Negotiables
- Never commit `.env` or real secrets
- Never log secret values — only log present/missing
- Secrets live in Railway Variables only

## Critical Architecture Rules
- Webhook route must be mounted BEFORE `express.json()` in `app.js`
- All WhatsApp sends go through `services/notify.js` only
- Booking confirmation source of truth = `/webhook/razorpay`
- `confirmBooking()` looks up by `order_id` only — not user_id

## Coding Conventions
- CommonJS (`require`) throughout — do not convert to ESM
- All DB access goes through `services/db.js` (Prisma client)
- `prisma generate` runs automatically via `postinstall` script on Railway deploy
- Default drivers loaded from `models/driverStore.js` when `data/drivers.json` missing

## Deploy
- Push to GitHub → Railway auto-redeploys
- Verify: logs show `RUNNING <PORT>` + `ENV KEY: loaded`
- See `docs/DEPLOYMENT.md` for full process

## Reference Docs
- Auth/secrets/tokens → `docs/SECURITY.md`
- Infra changes → `docs/DEPLOYMENT.md`
- Booking/payment flows → `docs/ARCHITECTURE.md`
