# TOVA System Architecture

## Stack

| Layer | Tech | Host |
|-------|------|------|
| Frontend | Next.js 16 (App Router) | Vercel |
| Backend | Node.js + Express | Railway |
| Payments | Razorpay | Razorpay Cloud |
| WhatsApp | Meta Cloud API v25.0 | Meta |
| Storage | JSON files (bookings, drivers) | Railway FS |

## Request Flow

```
User (WhatsApp)
    ↓ sends "hi"
POST /whatsapp/incoming
    ↓ session state machine
Checkout link sent: /checkout?ride=1&user=+91...
    ↓
Frontend (Vercel) loads checkout page
    ↓ Pay Now clicked
POST /payment/create  →  Razorpay order created  →  booking stored (CREATED)
    ↓
Razorpay popup opens → user completes payment
    ↓
Razorpay calls POST /webhook/razorpay
    ↓ HMAC verified
confirmBooking() → status = CONFIRMED, seat decremented
    ↓
notifyUser() → Meta WhatsApp API → message delivered
    ↓
Frontend calls POST /payment/verify (secondary check)
    ↓ booking already CONFIRMED → returns success
Frontend redirects to /success
```

## Key Files

| File | Responsibility |
|------|---------------|
| `app.js` | Express setup, route mounting. Webhook BEFORE express.json() |
| `routes/payment.js` | Create Razorpay order, createBooking() |
| `routes/verify.js` | Secondary HMAC check, fallback confirm |
| `routes/webhook.js` | Primary confirmation path — source of truth |
| `routes/whatsapp.js` | Conversation state machine, checkout link generation |
| `models/bookingStore.js` | Booking CRUD, seat enforcement, JSON persistence |
| `models/driverStore.js` | Driver supply, seat reduction, onboarding |
| `services/matching.js` | Ride matching by route/time, pricing (₹8/km, min ₹40, max ₹150) |
| `services/notify.js` | Meta WhatsApp Cloud API sender |
| `data/bookings.json` | Live booking state (gitignored) |
| `data/drivers.json` | Driver roster (gitignored) |

## Booking State Machine

```
CREATED → CONFIRMED → (future: IN_PROGRESS → COMPLETED)
                    → FAILED (overbooking or payment failure)
```

## Supply Rules

- Only 2 routes active: Sainikpuri↔Hitech City
- Only 2 time slots: 8:00 AM, 6:00 PM
- Seat count enforced per ride — overbooking rejected at confirmBooking()
- Driver seats decremented on confirmation

## WhatsApp Mode

- `WHATSAPP_MODE=sandbox` → sends `hello_world` template (Meta test numbers)
- `WHATSAPP_MODE=production` → sends custom text (requires Meta business verification)
