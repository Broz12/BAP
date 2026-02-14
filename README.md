# MLBB Pro Top-Up Platform

Production-ready Mobile Legends top-up service with Supabase Auth/Postgres/Storage, Stripe checkout + webhooks, wallet payments, referral commissions, invoice generation, WhatsApp admin notifications, and admin queue analytics.

## Stack
- Frontend: HTML5, CSS3, Vanilla JavaScript modules, Three.js, Chart.js
- Backend: Supabase (Auth, Postgres, Storage, RLS), Supabase Edge Functions
- Payments: Stripe Checkout (test/live mode)
- Notifications: WhatsApp Cloud API + deep-link fallback

## Project Structure
```text
/css/style.css
/js/app.js
/js/auth.js
/js/wallet.js
/js/referral.js
/js/shop.js
/js/admin.js
/js/three-hero.js
/js/currency.js
/js/dashboard.js
/js/runtime-config.js
/supabase/config.js
/supabase/config.toml
/supabase/sql/schema.sql
/supabase/functions/_shared/*
/supabase/functions/create-stripe-session/index.ts
/supabase/functions/stripe-webhook/index.ts
/supabase/functions/wallet-pay/index.ts
/supabase/functions/admin-update-order/index.ts
/supabase/functions/exchange-rate-sync/index.ts
index.html
topup.html
dashboard.html
admin.html
success.html
cancel.html
```

## Core Business Flow
1. User signs up / logs in.
2. User selects package and enters `Player ID` + `Server ID`.
3. User pays by `Stripe` or `Wallet`.
4. Order is stored in `orders`.
5. Admin processes recharge manually from queue.
6. Admin marks order as completed.

Disclaimer displayed across UI:
`This website is not affiliated with Moonton or Mobile Legends.`

## Setup Instructions

### 1. Supabase project
1. Create a Supabase project.
2. Open SQL Editor and run: `/Users/Jend X/BAP/supabase/sql/schema.sql`
3. Confirm tables, functions, policies, and `invoices` bucket were created.

### 2. Create an admin user
1. Register a user from the app.
2. Promote role in SQL:
```sql
update public.users
set role = 'admin'
where email = 'admin@example.com';
```

### 3. Configure frontend runtime
Edit `/Users/Jend X/BAP/js/runtime-config.js` and set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `APP_BASE_URL`
- `SUPABASE_FUNCTIONS_URL` (or keep empty to use `<SUPABASE_URL>/functions/v1`)
- `ADMIN_WHATSAPP_NUMBER`

### 4. Configure Edge Function secrets
Set these in Supabase:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ADMIN_TO`
- `WHATSAPP_API_VERSION` (optional, default `v20.0`)
- `EXCHANGE_RATE_CRON_SECRET`

### 5. Deploy Edge Functions
```bash
supabase functions deploy create-stripe-session
supabase functions deploy stripe-webhook
supabase functions deploy wallet-pay
supabase functions deploy admin-update-order
supabase functions deploy exchange-rate-sync
```

### 6. Stripe webhook setup
In Stripe Dashboard (test mode):
- Endpoint URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
- Events:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `checkout.session.async_payment_failed`
- Copy signing secret into `STRIPE_WEBHOOK_SECRET`.

### 7. Schedule exchange-rate updates (24h)
Run daily cron that calls:
- `POST https://<project-ref>.supabase.co/functions/v1/exchange-rate-sync`
- Header: `x-cron-secret: <EXCHANGE_RATE_CRON_SECRET>`

Use Supabase Scheduled Functions, GitHub Actions cron, or external cron service.

## API Examples

### Stripe checkout session (topup)
`POST /functions/v1/create-stripe-session`
```json
{
  "type": "topup",
  "productId": "<uuid>",
  "playerId": "123456789",
  "serverId": "1234",
  "currency": "PHP",
  "successUrl": "https://your-domain.com/success.html",
  "cancelUrl": "https://your-domain.com/cancel.html"
}
```

### Stripe checkout session (wallet deposit)
`POST /functions/v1/create-stripe-session`
```json
{
  "type": "wallet_deposit",
  "amount": 500,
  "currency": "INR",
  "successUrl": "https://your-domain.com/success.html",
  "cancelUrl": "https://your-domain.com/cancel.html"
}
```

### Wallet payment
`POST /functions/v1/wallet-pay`
```json
{
  "productId": "<uuid>",
  "playerId": "123456789",
  "serverId": "1234",
  "currency": "MYR"
}
```

### Admin order status update
`POST /functions/v1/admin-update-order`
```json
{
  "orderId": "<uuid>",
  "orderStatus": "processing",
  "adminNote": "Recharge queued with provider"
}
```

## WhatsApp Cloud API Structure
Implemented in `/Users/Jend X/BAP/supabase/functions/_shared/whatsapp.ts`.

Payload format sent to Meta Graph API:
```json
{
  "messaging_product": "whatsapp",
  "to": "<WHATSAPP_ADMIN_TO>",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "MLBB Pro Top-Up: Paid Order\nOrder ID: ..."
  }
}
```

Fallback deep-link is generated as:
- `https://wa.me/<admin-number>?text=<encoded-message>`

## Deployment Guide

### Netlify
1. Push this repository.
2. Create Netlify site from repo.
3. Build command: none (static)
4. Publish directory: `.`
5. Security headers are in `/Users/Jend X/BAP/netlify.toml`.

### Vercel
1. Import project in Vercel.
2. Framework preset: `Other`.
3. Build command: none.
4. Output directory: `.`
5. Security headers are in `/Users/Jend X/BAP/vercel.json`.

### GitHub Pages
1. This repo includes workflow `/Users/Jend X/BAP/.github/workflows/deploy-pages.yml`.
2. In GitHub repository settings: `Pages` -> `Source: GitHub Actions`.
3. Push to `main`; workflow deploys site automatically.
4. Expected URL format: `https://<username>.github.io/<repo>/`.
5. Set `/Users/Jend X/BAP/js/runtime-config.js` values before deployment.

## Security Controls Included
- Supabase RLS for all business tables.
- Role-based access (`user`/`admin`) with protected admin operations.
- Stripe webhook signature verification.
- Wallet debit/credit done server-side via SQL functions.
- Idempotent deposit and referral processing.
- Input validation on frontend + edge functions.
- Duplicate submit prevention on critical forms.

## Operational Notes
- Wallet ledger stores USD base (`amount_usd`) plus original currency amount for display/audit.
- Referral commission is 5% of successful paid order value (USD basis), credited server-side.
- Invoices are generated on successful payment and stored in private `invoices` bucket.
