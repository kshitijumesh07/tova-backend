# TOVA Backend — Claude Operating Rules

@docs/SECURITY.md
@docs/DEPLOYMENT.md
@docs/ARCHITECTURE.md

# Security + Infrastructure Rules

## Mandatory Security Controls

- Rotate all tokens, API keys, and secrets regularly.
- Never expose secrets client-side.
- Store secrets only in Railway environment variables.
- Enable MFA on: GitHub, Railway, Meta Developer, Razorpay.
- Restrict team/member access to minimum required permissions.
- Use separate environments for: Development, Staging, Production.
- Audit connected OAuth / third-party apps regularly.
- Monitor deployment logs, auth events, and unusual access.

## Secrets Policy

- `.env` is gitignored and never committed.
- `.env.example` contains only placeholder keys — no real values.
- All production secrets live in Railway Variables dashboard only.
- Never log secret values — only log whether they are loaded (present/missing).

## Code Rules

- Never hardcode ride prices, seat counts, or phone numbers in route files.
- All supply data lives in `data/drivers.json`.
- Booking state lives in `data/bookings.json` — never in memory only.
- WhatsApp notifications go through `services/notify.js` only.
- Webhook route must always be mounted BEFORE `express.json()` in app.js.

## Deployment Policy

- Backend: Railway. Do not migrate without product traction justification.
- Push to GitHub to trigger Railway redeploy — never deploy manually.
- Always confirm Railway deploy logs show `RUNNING` + `ENV KEY: loaded` after push.

## Founder Priority Rule

Do not optimize infrastructure before product traction.
Growth > premature infra changes.
